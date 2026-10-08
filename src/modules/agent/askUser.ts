import { z } from "zod";
import { ApiError } from "../../http/errors";
import { DEFAULT_TOOL_CALL_MESSAGE } from "./agentParser";

/**
 * The ask_user contract. The agent asks 1-4 multiple-choice questions; the run ends
 * with them on its reply (`metadata.askUser`), the composer turns into a picker, and
 * the user's answers come back as their next message (`metadata.answers`).
 */

export const ASK_USER_TOOL_NAME = "ask_user";
export const DEFAULT_ASK_USER_LEAD_IN = "I need a few details before I continue.";
export const ASK_USER_RESUME_BLOCK =
  "The user's latest message answers the questions you asked with ask_user. Continue the work you paused, starting from the current itinerary draft state. Do not ask the same questions again.";

const MAX_QUESTIONS = 4;
const HEADER_MAX = 16;
const LABEL_MAX = 40;
const DESCRIPTION_MAX = 120;
const QUESTION_MAX = 300;
const OTHER_MAX = 500;
const QUESTION_ID = /^q[1-4]$/;
// The panel always offers "Something else", so an option that only says that is dropped.
const OTHER_OPTION_LABEL = /^(other|something else|none of these)\.?$/i;

const optionSchema = z.object({
  label: z.string().trim().min(1).max(LABEL_MAX),
  description: z.string().trim().min(1).max(DESCRIPTION_MAX).optional()
});

const questionSchema = z
  .object({
    id: z.string().regex(QUESTION_ID),
    header: z.string().trim().min(1).max(HEADER_MAX),
    question: z.string().trim().min(1).max(QUESTION_MAX),
    multiSelect: z.boolean(),
    options: z.array(optionSchema).min(2).max(4)
  })
  .superRefine((question, context) => {
    const labels = question.options.map((option) => option.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", path: ["options"], message: "Option labels must be unique within a question." });
    }
  });

export const askUserPayloadSchema = z.object({
  questions: z.array(questionSchema).min(1).max(MAX_QUESTIONS)
});

export type AskUserQuestion = z.infer<typeof questionSchema>;
export type AskUserPayload = z.infer<typeof askUserPayloadSchema>;

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LooseRecord) : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Headers become stepper chips, so a long one is cut at a word break rather than rejected.
function shortHeader(header: string) {
  if (header.length <= HEADER_MAX) return header;
  const lastSpace = header.slice(0, HEADER_MAX + 1).lastIndexOf(" ");
  return (lastSpace > 0 ? header.slice(0, lastSpace) : header.slice(0, HEADER_MAX)).trim();
}

function looseOption(value: unknown) {
  if (typeof value === "string") return { label: value.trim() };
  const record = asRecord(value) ?? {};
  const description = text(record.description);
  return { label: text(record.label) ?? text(record.title) ?? "", ...(description ? { description } : {}) };
}

function looseQuestion(value: unknown, index: number) {
  const record = asRecord(value) ?? {};
  const options = Array.isArray(record.options) ? record.options.map(looseOption) : [];
  return {
    id: `q${index + 1}`,
    header: shortHeader(text(record.header) ?? `Question ${index + 1}`),
    question: text(record.question) ?? "",
    multiSelect: record.multiSelect === true,
    options: options.filter((option) => !OTHER_OPTION_LABEL.test(option.label))
  };
}

/**
 * Turn the model's ask_user input into the stored payload. Accepts the documented
 * shape plus the shortcuts Gemini uses: one top-level question instead of a
 * `questions` array, and options as plain strings. Invalid input throws a ZodError,
 * which the tool registry reports as AGENT_TOOL_INPUT_INVALID so the model can retry.
 */
export function normalizeAskUserInput(input: unknown): AskUserPayload {
  const record = asRecord(input) ?? {};
  const rawQuestions = Array.isArray(record.questions)
    ? record.questions
    : record.question !== undefined
      ? [record]
      : [];
  return askUserPayloadSchema.parse({ questions: rawQuestions.map(looseQuestion) });
}

export function parseStoredAskUser(metadata: unknown): AskUserPayload | null {
  const parsed = askUserPayloadSchema.safeParse(asRecord(metadata)?.askUser);
  return parsed.success ? parsed.data : null;
}

/** The ask_user call as the model makes it, without the server-assigned ids. */
export function renderAskUserToolCall(payload: AskUserPayload): string {
  return JSON.stringify({
    tool: ASK_USER_TOOL_NAME,
    questions: payload.questions.map(({ header, question, multiSelect, options }) => ({
      header,
      question,
      multiSelect,
      options
    }))
  });
}

/**
 * History content for an assistant message. A reply that asked questions stores only
 * its lead-in, so the model is shown the ask_user call it made, then the lead-in.
 */
export function assistantHistoryContent(content: string, metadata: unknown): string {
  const askUser = parseStoredAskUser(metadata);
  return askUser ? `${renderAskUserToolCall(askUser)}\n${content}` : content;
}

/** The chat sentence shown with the questions; the parser's placeholder doesn't count. */
export function askUserLeadIn(assistantMessage: string | undefined): string {
  const trimmed = (assistantMessage ?? "").trim();
  return trimmed && trimmed !== DEFAULT_TOOL_CALL_MESSAGE ? trimmed : DEFAULT_ASK_USER_LEAD_IN;
}

export function hasAskUserAnswers(metadata: unknown): boolean {
  return asRecord(asRecord(metadata)?.answers) !== null;
}

export const askUserAnswersSchema = z
  .object({
    // Looked up inside the caller's own thread, so any id string is safe here.
    messageId: z.string().min(1).max(64),
    items: z
      .array(
        z
          .object({
            questionId: z.string().regex(QUESTION_ID),
            selected: z.array(z.string().trim().min(1).max(LABEL_MAX)).max(4).default([]),
            other: z.string().trim().max(OTHER_MAX).optional()
          })
          .strict()
      )
      .min(1)
      .max(MAX_QUESTIONS)
  })
  .strict();

export type AskUserAnswersInput = z.infer<typeof askUserAnswersSchema>;

export type StoredAskUserAnswers = {
  messageId: string;
  items: Array<{ questionId: string; header: string; question: string; selected: string[]; other?: string }>;
};

export function questionNotPendingError() {
  return new ApiError(409, "QUESTION_NOT_PENDING", "This question was already answered.");
}

/**
 * Check answers against the questions they reply to. Returns the stored form, which
 * copies each question's header so the chat can show "Transport · Public transit".
 */
export function resolveAskUserAnswers(payload: AskUserPayload, answers: AskUserAnswersInput): StoredAskUserAnswers {
  const invalid = (message: string) => new ApiError(400, "ASK_USER_ANSWERS_INVALID", message);
  const askedIds = new Set(payload.questions.map((question) => question.id));
  const answerIds = answers.items.map((item) => item.questionId);
  if (new Set(answerIds).size !== answerIds.length) throw invalid("Each question can be answered only once.");
  if (answerIds.some((id) => !askedIds.has(id))) throw invalid("An answer refers to a question that was not asked.");

  const items = payload.questions.map((question) => {
    const item = answers.items.find((candidate) => candidate.questionId === question.id);
    if (!item) throw invalid(`Answer "${question.header}" too.`);
    const labels = new Set(question.options.map((option) => option.label));
    const selected = [...new Set(item.selected)];
    if (selected.some((label) => !labels.has(label))) {
      throw invalid(`"${question.header}" got an answer that isn't one of its options.`);
    }
    const other = item.other?.trim() || undefined;
    const count = selected.length + (other ? 1 : 0);
    if (count === 0) throw invalid(`Answer "${question.header}" too.`);
    if (!question.multiSelect && count > 1) throw invalid(`"${question.header}" takes one answer.`);
    return {
      questionId: question.id,
      header: question.header,
      question: question.question,
      selected,
      ...(other ? { other } : {})
    };
  });

  return { messageId: answers.messageId, items };
}
