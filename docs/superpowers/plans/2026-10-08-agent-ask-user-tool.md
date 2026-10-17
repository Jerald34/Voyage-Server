# Agent ask_user Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Voyage agent asks the user questions through an `ask_user` tool instead of markdown bullets, and the chat composer turns into a question panel while a question is open.

**Architecture:** `ask_user` is a terminal tool. When the agent calls it, the orchestrator ends the run and saves the questions on the assistant reply (`metadata.askUser`). The client sees the open question and swaps `ChatInput` for `AskUserPanel`. The answers go out as a normal user message with `metadata.answers`, which starts a new run. That run is told it was resumed and continues from the saved draft.

**Tech Stack:** Server: Express 5, TypeScript, Zod 4, Prisma 7, Vitest. Client: Next 16, React 19, Tailwind v4 tokens in `app/globals.css`, Vitest with React Testing Library.

---

## Design decisions (approved in chat 2026-10-08)

1. **Scope.** The tool covers clarifying questions before work (transport, trip length, which "Tokyo") and mid-build decisions (for example, rain on a must-do outdoor day). Confirming destructive changes is **out of scope**.
2. **Batching.** One `ask_user` call carries 1–4 questions. The panel steps through them and sends every answer as one message, so it costs one run.
3. **Composer (mockup A).** The composer itself becomes the question panel:
   - stepper chips (one per question header) and an "N of M" counter
   - radio rows for single choice, checkbox rows when `multiSelect` is set, each with a label and optional description
   - a "Something else" text field, always present
   - Back / Next / "Send answers" buttons
   - "Type a normal reply instead", which brings back the normal text box
4. **Approach 1, ask then end the run.** There is no paused run. The answer starts a new run, and its runtime context gets a resume hint. Asking skips the synthesis pass; the agent's sentence after the JSON becomes the reply text.
5. **History (mockup A).** The user's answer bubble pairs each question's header with its answer (`Transport · Public transit`). If the user skipped a question, the agent's reply shows a line like "Not answered: Transport, Trip length".

**Defaults chosen during design (not separately reviewed):**
- **Limits.** `header` ≤ 16 characters, cut at a word break instead of rejected. A missing header becomes "Question N". Option labels ≤ 40 characters, descriptions ≤ 120, question text ≤ 300, typed answer ≤ 500.
- **Tolerant parsing.** The server accepts a single top-level `question` and options sent as plain strings. It drops an option labelled "Other" or "Something else", since the panel already offers one. Any other bad input becomes `AGENT_TOOL_INPUT_INVALID`, which goes back to the model so it can correct the call.
- **Double answers.** An answer is accepted only while its question is still the thread's newest USER or ASSISTANT message. The check runs inside the insert transaction under a per-thread advisory lock. Otherwise the server returns 409 `QUESTION_NOT_PENDING` and the client reloads the thread.
- **Process summary label.** The label is "Asked for your input · Xs", without a question count. The mockup said "Asked 2 questions", but the timeline doesn't carry the count.
- **Message metadata on reload.** The client message normalizer now keeps the whole `metadata` object instead of only `itineraryId`. This also fixes user images disappearing after a reload.
- **Duplicate check.** The live reply commit uses the server message id, so answers can name the reply. It also checks for duplicates by that id instead of by text, because two replies can share the same fallback sentence.

## Conventions for this plan

- Both repos stay on the branch that is checked out (`staging`). Do not create or switch branches.
- Commit after every task, in the repo that task touches. Never add a `Co-Authored-By` line. Never push.
- Server tests run from `Voyage-Server`: `npx vitest run <file>`.
- Client tests run from `Voyage-Client`: `npx vitest run --pool=threads <file>`.
- OneDrive breaks file watching, so restart the backend after server edits (`tsx watch` misses them). If the client serves stale CSS, stop dev, delete `.next/dev`, and restart.

## File map

**Voyage-Server**

| File | Change |
|---|---|
| `src/modules/agent/askUser.ts` | **Create.** The contract: schemas, tolerant normalizer, model-history rendering, lead-in, answer validation, resume hint |
| `src/modules/agent/tools/askUserTools.ts` | **Create.** `createAskUserTool()`, which validates the input and returns the questions |
| `src/modules/agent/tools/index.ts` | Export the new tool |
| `src/modules/agent/agentFactory.ts` | Register `ask_user` |
| `src/modules/agent/agentParser.ts` | Export `DEFAULT_TOOL_CALL_MESSAGE`; add tool-name aliases |
| `src/modules/agent/agentTypes.ts` | Add `CompleteRunOptions`, `answersTo`, `askUser`, and history `metadata` types |
| `src/modules/agent/agentService.ts` | Pass `askUser` through `completeRun`; validate answers; add the summary label |
| `src/modules/agent/agentRepository.ts` | Store `askUser` metadata; add the pending-question check under a lock |
| `src/modules/agent/agentSchemas.ts` | Add optional `answers` to `createMessageSchema` |
| `src/modules/agent/agentController.ts` | Pass `answers` to the service |
| `src/modules/agent/agentOrchestrator.ts` | Make `ask_user` end the run; show questions in history; add the resume hint |
| `src/modules/agent/agentPrompts.ts` | Replace the markdown-question rules with `ask_user` rules |
| `tests/askUser.test.ts`, `tests/agentAskUserRepository.test.ts`, `tests/askUserPrompt.test.ts` | **Create** |
| `tests/agentService.test.ts`, `tests/agentOrchestrator.test.ts` | Update the memory repository and fakes; add tests |

**Voyage-Client**

| File | Change |
|---|---|
| `app/lib/agent/askUser.js` | **Create.** Find the pending question, compute per-message status, build the answer, read answers |
| `app/components/trip-dashboard/command-center/AskUserPanel.jsx` | **Create.** The question panel |
| `app/components/trip-dashboard/command-center/ChatComposer.jsx` | **Create.** Switches between the panel and `ChatInput` |
| `app/hooks/useAgentRunStream.js` | Keep the `message.completed` `messageId` and `askUser` |
| `app/hooks/useAgentStreamOrchestration.js` | Commit with the server id and `metadata.askUser`; check duplicates by id |
| `app/hooks/useTripPlanning.js` | Keep full metadata; send `answers` from `dispatchMessage`; reload on a 409 |
| `app/lib/api/agent.js` | Add `answers` to `sendMessage` |
| `app/components/trip-dashboard/command-center/AgentCommandCenter.jsx` | Use `ChatComposer`; pass `askUserStatus`; hide edit on answers |
| `app/components/trip-dashboard/command-center/ChatMessage.jsx` | Render answer pairs and the "Not answered" line |
| `app/components/trip-dashboard/HomePage.jsx` | Wire stream values; mobile footer uses `ChatComposer`; add `answerAgentQuestion` |
| `app/components/agent/process-bubble/processBubbleLabels.js` | Add `ask_user` labels |
| `tests/ask-user-*.test.*`, `tests/chat-composer.test.jsx`, `tests/use-agent-stream-orchestration.test.jsx`, `tests/thread-message-metadata.test.js` | **Create** |
| `tests/useAgentRunStream.test.js`, `tests/process-bubble-labels.test.js` | Add tests |

---

## Task 0: Baseline

**Files:** none.

- [ ] **Step 1: Record the server baseline**

Run from `Voyage-Server`: `npm test 2>&1 | tail -15`, then `npm run build`.
Write down the failing test files, if any. Some failures already exist, and later tasks must not add new ones.

- [ ] **Step 2: Record the client baseline**

Run from `Voyage-Client`: `npm test 2>&1 | tail -15`.
Write down the failing test files, if any.

---

## Task S1: The ask_user contract

**Files:**
- Create: `Voyage-Server/src/modules/agent/askUser.ts`
- Modify: `Voyage-Server/src/modules/agent/agentParser.ts`
- Test: `Voyage-Server/tests/askUser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `Voyage-Server/tests/askUser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  DEFAULT_ASK_USER_LEAD_IN,
  assistantHistoryContent,
  askUserLeadIn,
  normalizeAskUserInput,
  parseStoredAskUser,
  resolveAskUserAnswers
} from "../src/modules/agent/askUser";
import { DEFAULT_TOOL_CALL_MESSAGE, canonicalToolName } from "../src/modules/agent/agentParser";

const transport = {
  header: "Transport",
  question: "How will the travelers get around?",
  options: [
    { label: "Private car", description: "Most stops per day" },
    { label: "Public transit" },
    { label: "Walking" }
  ]
};

const interests = {
  header: "Interests",
  question: "What should the days focus on?",
  multiSelect: true,
  options: [{ label: "Food" }, { label: "Museums" }, { label: "Nature" }]
};

function errorOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("normalizeAskUserInput", () => {
  it("numbers the questions and defaults multiSelect to false", () => {
    const payload = normalizeAskUserInput({ questions: [transport, interests] });

    expect(payload.questions.map((question) => question.id)).toEqual(["q1", "q2"]);
    expect(payload.questions[0]).toMatchObject({ header: "Transport", multiSelect: false });
    expect(payload.questions[0].options[0]).toEqual({ label: "Private car", description: "Most stops per day" });
    expect(payload.questions[1].multiSelect).toBe(true);
  });

  it("accepts one top-level question with plain-string options", () => {
    const payload = normalizeAskUserInput({
      header: "City",
      question: "Which Tokyo did you mean?",
      options: ["Tokyo, Japan", "Tokyo Disneyland"]
    });

    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0].options).toEqual([{ label: "Tokyo, Japan" }, { label: "Tokyo Disneyland" }]);
  });

  it("drops an Other option because the panel always offers one", () => {
    const payload = normalizeAskUserInput({
      questions: [{ ...transport, options: [...transport.options, { label: "Other" }] }]
    });

    expect(payload.questions[0].options.map((option) => option.label)).toEqual(["Private car", "Public transit", "Walking"]);
  });

  it("shortens a long header at a word break and names a missing one", () => {
    const payload = normalizeAskUserInput({
      questions: [{ ...transport, header: "Accommodation type" }, { ...interests, header: undefined }]
    });

    expect(payload.questions[0].header).toBe("Accommodation");
    expect(payload.questions[1].header).toBe("Question 2");
  });

  it.each([
    ["more than four questions", { questions: [transport, transport, transport, transport, transport] }],
    ["a question with one option", { questions: [{ ...transport, options: [{ label: "Car" }] }] }],
    ["duplicate option labels", { questions: [{ ...transport, options: [{ label: "Car" }, { label: "car" }] }] }],
    ["no question text", { questions: [{ ...transport, question: "  " }] }],
    ["no questions at all", {}]
  ])("rejects %s", (_name, input) => {
    expect(() => normalizeAskUserInput(input)).toThrow(ZodError);
  });
});

describe("ask_user tool name", () => {
  it("maps the names models invent onto ask_user", () => {
    expect(canonicalToolName("AskUserQuestion")).toBe("ask_user");
    expect(canonicalToolName("ask-user")).toBe("ask_user");
    expect(canonicalToolName("askUser")).toBe("ask_user");
  });
});

describe("assistant history content", () => {
  it("shows the model the ask_user call it made, then the lead-in", () => {
    const askUser = normalizeAskUserInput({ questions: [transport] });

    const content = assistantHistoryContent("A couple of details first.", { process: {}, askUser });

    expect(content.startsWith('{"tool":"ask_user","questions":[{"header":"Transport"')).toBe(true);
    expect(content.endsWith("\nA couple of details first.")).toBe(true);
    expect(content).not.toContain('"id":"q1"');
  });

  it("leaves a reply without questions unchanged", () => {
    expect(assistantHistoryContent("Done.", { process: {} })).toBe("Done.");
    expect(assistantHistoryContent("Done.", null)).toBe("Done.");
  });

  it("ignores stored questions that no longer parse", () => {
    expect(parseStoredAskUser({ askUser: { questions: [] } })).toBeNull();
  });
});

describe("askUserLeadIn", () => {
  it("keeps the model's sentence", () => {
    expect(askUserLeadIn("  Day 3 looks rainy.  ")).toBe("Day 3 looks rainy.");
  });

  it("falls back when the parser filled in its placeholder", () => {
    expect(askUserLeadIn(DEFAULT_TOOL_CALL_MESSAGE)).toBe(DEFAULT_ASK_USER_LEAD_IN);
    expect(askUserLeadIn("")).toBe(DEFAULT_ASK_USER_LEAD_IN);
  });
});

describe("resolveAskUserAnswers", () => {
  const payload = normalizeAskUserInput({ questions: [transport, interests] });
  const messageId = "message-2";

  it("returns the answers with each question's header", () => {
    const stored = resolveAskUserAnswers(payload, {
      messageId,
      items: [
        { questionId: "q1", selected: ["Public transit"] },
        { questionId: "q2", selected: ["Food", "Museums"], other: "Night markets" }
      ]
    });

    expect(stored).toEqual({
      messageId,
      items: [
        { questionId: "q1", header: "Transport", question: transport.question, selected: ["Public transit"] },
        {
          questionId: "q2",
          header: "Interests",
          question: interests.question,
          selected: ["Food", "Museums"],
          other: "Night markets"
        }
      ]
    });
  });

  it("accepts a typed answer in place of an option", () => {
    const stored = resolveAskUserAnswers(payload, {
      messageId,
      items: [
        { questionId: "q1", selected: [], other: "Hired driver" },
        { questionId: "q2", selected: ["Food"] }
      ]
    });

    expect(stored.items[0]).toMatchObject({ selected: [], other: "Hired driver" });
  });

  it.each([
    ["an answer that is not an option", [{ questionId: "q1", selected: ["Boat"] }, { questionId: "q2", selected: ["Food"] }]],
    [
      "two answers to a single-choice question",
      [{ questionId: "q1", selected: ["Walking", "Public transit"] }, { questionId: "q2", selected: ["Food"] }]
    ],
    [
      "an option plus typed text on a single-choice question",
      [{ questionId: "q1", selected: ["Walking"], other: "Bike" }, { questionId: "q2", selected: ["Food"] }]
    ],
    ["a missing question", [{ questionId: "q1", selected: ["Walking"] }]],
    ["an empty answer", [{ questionId: "q1", selected: [] }, { questionId: "q2", selected: ["Food"] }]],
    [
      "a question that was not asked",
      [
        { questionId: "q1", selected: ["Walking"] },
        { questionId: "q2", selected: ["Food"] },
        { questionId: "q3", selected: ["Food"] }
      ]
    ],
    ["the same question twice", [{ questionId: "q1", selected: ["Walking"] }, { questionId: "q1", selected: ["Walking"] }]]
  ])("rejects %s", (_name, items) => {
    expect(errorOf(() => resolveAskUserAnswers(payload, { messageId, items }))).toMatchObject({
      code: "ASK_USER_ANSWERS_INVALID",
      statusCode: 400
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/askUser.test.ts`
Expected: FAIL. The module `../src/modules/agent/askUser` can't be resolved.

- [ ] **Step 3: Export the parser placeholder and add the aliases**

In `Voyage-Server/src/modules/agent/agentParser.ts`, add this constant directly after the `export type ParsedModelOutput = ...;` block:

```ts
/** What the parser says for a tool call that came with no text of its own. */
export const DEFAULT_TOOL_CALL_MESSAGE = "Working on that now.";
```

There are four `"Working on that now."` literals (near lines 217, 270, 368 and 421). Replace each with `DEFAULT_TOOL_CALL_MESSAGE`. For example, `content.slice(0, match.index).trim() || "Working on that now."` becomes `content.slice(0, match.index).trim() || DEFAULT_TOOL_CALL_MESSAGE`.

In `canonicalToolName`, replace:

```ts
    place_insights_tool: "place_insights"
  };
```

with:

```ts
    place_insights_tool: "place_insights",
    askuser: "ask_user",
    askuserquestion: "ask_user",
    ask_user_question: "ask_user",
    ask_question: "ask_user"
  };
```

- [ ] **Step 4: Create the contract module**

Create `Voyage-Server/src/modules/agent/askUser.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/askUser.test.ts tests/agentLogger.test.ts`
Expected: PASS, all green. `agentLogger` uses the placeholder text, so it still passes after the parser change.

- [ ] **Step 6: Commit**

```bash
git add src/modules/agent/askUser.ts src/modules/agent/agentParser.ts tests/askUser.test.ts
git commit -m "feat(agent): define the ask_user question contract"
```

---

## Task S2: The ask_user tool

**Files:**
- Create: `Voyage-Server/src/modules/agent/tools/askUserTools.ts`
- Modify: `Voyage-Server/src/modules/agent/tools/index.ts`, `Voyage-Server/src/modules/agent/agentFactory.ts`
- Test: `Voyage-Server/tests/askUser.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this import to the top of `tests/askUser.test.ts`:

```ts
import { createAgentToolRegistry, createAskUserTool } from "../src/modules/agent/agentTools";
```

Append to the file:

```ts
describe("ask_user tool", () => {
  const context = { agencyId: "agency-1", threadId: "thread-1", runId: "run-1", userId: "user-1" };

  it("returns the normalized questions", async () => {
    const registry = createAgentToolRegistry([createAskUserTool()]);

    const output = await registry.execute("ask_user", context, { questions: [transport] });

    expect(output).toEqual(normalizeAskUserInput({ questions: [transport] }));
  });

  it("reports bad input as AGENT_TOOL_INPUT_INVALID so the model can fix it", async () => {
    const registry = createAgentToolRegistry([createAskUserTool()]);

    await expect(
      registry.execute("ask_user", context, { questions: [{ ...transport, options: [] }] })
    ).rejects.toMatchObject({ code: "AGENT_TOOL_INPUT_INVALID", statusCode: 400 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/askUser.test.ts`
Expected: FAIL. `createAskUserTool` is not exported.

- [ ] **Step 3: Create the tool**

Create `Voyage-Server/src/modules/agent/tools/askUserTools.ts`:

```ts
import type { AgentTool } from "../agentTools";
import { ASK_USER_TOOL_NAME, normalizeAskUserInput } from "../askUser";

/**
 * ask_user validates the agent's questions and hands them back. It writes nothing:
 * the orchestrator ends the run with the questions on the reply.
 */
export function createAskUserTool(): AgentTool {
  return {
    name: ASK_USER_TOOL_NAME,
    async execute(_context, input) {
      return normalizeAskUserInput(input);
    }
  };
}
```

At the top of `Voyage-Server/src/modules/agent/tools/index.ts`, add:

```ts
export * from "./askUserTools";
```

In `Voyage-Server/src/modules/agent/agentFactory.ts`, add `createAskUserTool,` to the import list from `"./agentTools"` (after `createAgentToolRegistry,`). Then replace:

```ts
    createListAgentTasksTool({ agentService }),
```

with:

```ts
    createListAgentTasksTool({ agentService }),
    createAskUserTool(),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/askUser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/tools/askUserTools.ts src/modules/agent/tools/index.ts src/modules/agent/agentFactory.ts tests/askUser.test.ts
git commit -m "feat(agent): register the ask_user tool"
```

---

## Task S3: Save the questions on the reply

**Files:**
- Modify: `Voyage-Server/src/modules/agent/agentTypes.ts`, `agentService.ts`, `agentRepository.ts`
- Modify: `Voyage-Server/tests/agentService.test.ts` (memory repository)
- Test: `Voyage-Server/tests/agentService.test.ts`, create `Voyage-Server/tests/agentAskUserRepository.test.ts`

- [ ] **Step 1: Write the failing service tests**

In `tests/agentService.test.ts`, add this import below the existing imports:

```ts
import { normalizeAskUserInput } from "../src/modules/agent/askUser";
```

Add this block just before the final `export { createMemoryRepository };` line:

```ts
describe("ask_user replies", () => {
  const askUser = normalizeAskUserInput({
    questions: [
      { header: "Transport", question: "How will the travelers get around?", options: ["Private car", "Public transit"] }
    ]
  });

  it("stores the questions on the reply and sends them with message.completed", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Kyoto" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Plan Kyoto");

    const result = await service.completeRun(run.id, "A couple of details first.", undefined, { askUser });

    expect(result.message).toMatchObject({ content: "A couple of details first.", metadata: { askUser } });
    expect(repository.events.find((event) => event.type === "message.completed")?.payload).toMatchObject({
      content: "A couple of details first.",
      askUser
    });
  });

  it("summarizes a run that asked as asking for input", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Kyoto" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Plan Kyoto");
    await service.recordRunEvent(run, { type: "tool.started", payload: { name: "ask_user", input: {} } });
    await service.recordRunEvent(run, { type: "tool.completed", payload: { name: "ask_user", output: askUser } });

    const result = await service.completeRun(run.id, "A couple of details first.", undefined, { askUser });

    expect((result.message.metadata as any).process.activeLabel).toMatch(/^Asked for your input · /);
  });
});
```

- [ ] **Step 2: Write the failing repository test**

Create `Voyage-Server/tests/agentAskUserRepository.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaAgentRepository } from "../src/modules/agent/agentRepository";
import { normalizeAskUserInput } from "../src/modules/agent/askUser";

const askUser = normalizeAskUserInput({
  questions: [{ header: "Transport", question: "How will the travelers get around?", options: ["Private car", "Public transit"] }]
});

// A fake transaction client: just the calls these two repository methods make.
function createTx(latestMessageId: string | null = null) {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    agentRun: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => ({ id: "run-1", threadId: "thread-1" })),
      create: vi.fn(async ({ data }: any) => ({ id: "run-2", ...data }))
    },
    agentThread: { updateMany: vi.fn(async () => ({ count: 1 })) },
    agentMessage: {
      create: vi.fn(async ({ data }: any) => ({ id: "message-9", ...data })),
      findFirst: vi.fn(async () => (latestMessageId ? { id: latestMessageId } : null))
    },
    agentRunEvent: {
      aggregate: vi.fn(async () => ({ _max: { sequence: 4 } })),
      create: vi.fn(async ({ data }: any) => ({ id: `event-${data.sequence}`, ...data }))
    }
  };
  const client = {
    $transaction: vi.fn(async (work: (transaction: typeof tx) => unknown) => work(tx))
  } as unknown as PrismaClient;
  return { tx, client };
}

describe("completeRunIfOpen with questions", () => {
  it("writes the questions into the reply's metadata and the message.completed payload", async () => {
    const { tx, client } = createTx();

    await createPrismaAgentRepository(client).completeRunIfOpen("run-1", {
      assistantContent: "A couple of details first.",
      completedAt: new Date("2026-10-08T00:00:00Z"),
      processSnapshot: { status: "done" },
      askUser
    });

    expect(tx.agentMessage.create.mock.calls[0][0].data.metadata).toEqual({ process: { status: "done" }, askUser });
    const completedEvent = tx.agentRunEvent.create.mock.calls[0][0].data;
    expect(completedEvent.type).toBe("message.completed");
    expect(completedEvent.payload).toMatchObject({ content: "A couple of details first.", askUser });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/agentService.test.ts tests/agentAskUserRepository.test.ts`
Expected: FAIL. The metadata has no `askUser`, and the label reads "Worked for".

- [ ] **Step 4: Update the types**

In `Voyage-Server/src/modules/agent/agentTypes.ts`:

Below `import type { TravelerNeeds } from "./travelerNeeds";`, add:

```ts
import type { AskUserPayload } from "./askUser";
```

Below the `CompleteRunUsage` interface, add:

```ts
export type CompleteRunOptions = {
  /** Questions the run ended with; stored on the reply as `metadata.askUser`. */
  askUser?: AskUserPayload;
};
```

In `AgentOrchestratorAgentService`, replace:

```ts
  ): Promise<{ messages: Array<{ role: "USER" | "ASSISTANT" | "SYSTEM_VISIBLE"; content: string }>; travelerNeeds?: unknown }>;
```

with:

```ts
  ): Promise<{
    messages: Array<{ role: "USER" | "ASSISTANT" | "SYSTEM_VISIBLE"; content: string; metadata?: unknown }>;
    travelerNeeds?: unknown;
  }>;
```

and replace:

```ts
  completeRun(
    runId: string,
    assistantContent: string,
    usage?: CompleteRunUsage
  ): Promise<{ run: AgentRunRecord; message: AgentMessageRecord; events: AgentRunEventRecord[] }>;
```

with:

```ts
  completeRun(
    runId: string,
    assistantContent: string,
    usage?: CompleteRunUsage,
    options?: CompleteRunOptions
  ): Promise<{ run: AgentRunRecord; message: AgentMessageRecord; events: AgentRunEventRecord[] }>;
```

In `AgentRepository.completeRunIfOpen`, replace:

```ts
      processSnapshot?: Record<string, unknown>;
      usage?: CompleteRunUsage;
    }
```

with:

```ts
      processSnapshot?: Record<string, unknown>;
      usage?: CompleteRunUsage;
      askUser?: AskUserPayload;
    }
```

- [ ] **Step 5: Pass the questions through the service, and add the label**

In `Voyage-Server/src/modules/agent/agentService.ts`, add `CompleteRunOptions` to the `import type { ... } from "./agentTypes";` list. Add this import below it:

```ts
import { ASK_USER_TOOL_NAME } from "./askUser";
```

In `summarizeTimeline`, replace:

```ts
  if (toolEntries.length === 0) {
    return `Thought for ${durationStr}`;
  }

  const hasMapPinpoint = toolEntries.some((e) => e.name === "map_pinpoint");
```

with:

```ts
  if (toolEntries.length === 0) {
    return `Thought for ${durationStr}`;
  }

  if (toolEntries.some((e) => e.name === ASK_USER_TOOL_NAME)) {
    return `Asked for your input · ${durationStr}`;
  }

  const hasMapPinpoint = toolEntries.some((e) => e.name === "map_pinpoint");
```

Replace:

```ts
    async completeRun(runId: string, assistantContent: string, usage?: CompleteRunUsage) {
```

with:

```ts
    async completeRun(
      runId: string,
      assistantContent: string,
      usage?: CompleteRunUsage,
      completion: CompleteRunOptions = {}
    ) {
```

Then, in the same method, replace:

```ts
      const completed = await options.repository.completeRunIfOpen(runId, {
        assistantContent,
        completedAt,
        processSnapshot: processSnapshot ?? undefined,
        usage
      });
```

with:

```ts
      const completed = await options.repository.completeRunIfOpen(runId, {
        assistantContent,
        completedAt,
        processSnapshot: processSnapshot ?? undefined,
        usage,
        askUser: completion.askUser
      });
```

- [ ] **Step 6: Store the questions in the repository**

In `Voyage-Server/src/modules/agent/agentRepository.ts`, inside `completeRunIfOpen`, replace:

```ts
        const message = (await tx.agentMessage.create({
          data: {
            threadId: run.threadId,
            runId: run.id,
            role: "ASSISTANT",
            content: data.assistantContent,
            ...(data.processSnapshot != null
              ? { metadata: toJsonInput({ process: data.processSnapshot }) }
              : {})
          }
        })) as AgentMessageRecord;
```

with:

```ts
        const metadata = {
          ...(data.processSnapshot != null ? { process: data.processSnapshot } : {}),
          ...(data.askUser ? { askUser: data.askUser } : {})
        };
        const message = (await tx.agentMessage.create({
          data: {
            threadId: run.threadId,
            runId: run.id,
            role: "ASSISTANT",
            content: data.assistantContent,
            ...(Object.keys(metadata).length > 0 ? { metadata: toJsonInput(metadata) } : {})
          }
        })) as AgentMessageRecord;
```

and replace:

```ts
              payload: toJsonInput({
                messageId: message.id,
                content: data.assistantContent,
                ...(data.processSnapshot != null ? { process: data.processSnapshot } : {})
              }) as Prisma.InputJsonValue
```

with:

```ts
              payload: toJsonInput({
                messageId: message.id,
                content: data.assistantContent,
                ...metadata
              }) as Prisma.InputJsonValue
```

- [ ] **Step 7: Mirror the change in the memory repository**

In `tests/agentService.test.ts`, inside the memory repository's `completeRunIfOpen`, replace:

```ts
      const message = await this.createMessage({
        threadId: run.threadId,
        runId: run.id,
        role: "ASSISTANT",
        content: data.assistantContent,
        metadata: data.processSnapshot != null ? { process: data.processSnapshot } : null
      });
      const processPayload = data.processSnapshot != null ? { process: data.processSnapshot } : {};
```

with:

```ts
      const metadata = {
        ...(data.processSnapshot != null ? { process: data.processSnapshot } : {}),
        ...(data.askUser ? { askUser: data.askUser } : {})
      };
      const message = await this.createMessage({
        threadId: run.threadId,
        runId: run.id,
        role: "ASSISTANT",
        content: data.assistantContent,
        metadata: Object.keys(metadata).length > 0 ? metadata : null
      });
```

In the same method, change `payload: { messageId: message.id, content: data.assistantContent, ...processPayload },` to `payload: { messageId: message.id, content: data.assistantContent, ...metadata },`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/agentService.test.ts tests/agentAskUserRepository.test.ts tests/agentTaskTools.test.ts tests/agentTaskRepository.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/agent/agentTypes.ts src/modules/agent/agentService.ts src/modules/agent/agentRepository.ts tests/agentService.test.ts tests/agentAskUserRepository.test.ts
git commit -m "feat(agent): store ask_user questions on the reply"
```

---

## Task S4: Accept answers

**Files:**
- Modify: `Voyage-Server/src/modules/agent/agentSchemas.ts`, `agentService.ts`, `agentRepository.ts`, `agentTypes.ts`, `agentController.ts`
- Modify: `Voyage-Server/tests/agentService.test.ts` (memory repository)
- Test: `Voyage-Server/tests/agentService.test.ts`, `Voyage-Server/tests/agentAskUserRepository.test.ts`, `Voyage-Server/tests/askUser.test.ts`

- [ ] **Step 1: Write the failing service tests**

Append to `tests/agentService.test.ts`, before `export { createMemoryRepository };`:

```ts
describe("answering ask_user questions", () => {
  const askUser = normalizeAskUserInput({
    questions: [
      { header: "Transport", question: "How will the travelers get around?", options: ["Private car", "Public transit"] },
      { header: "Trip length", question: "How many days should I plan?", options: ["2 days", "3 days"] }
    ]
  });

  async function threadWithQuestion() {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Kyoto" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Plan Kyoto");
    const { message } = await service.completeRun(run.id, "A couple of details first.", undefined, { askUser });
    return { service, thread, questionId: message.id };
  }

  const answersFor = (messageId: string) => ({
    messageId,
    items: [
      { questionId: "q1", selected: ["Public transit"] },
      { questionId: "q2", selected: [], other: "4 days" }
    ]
  });

  it("saves the answers with their headers and starts a run", async () => {
    const { service, thread, questionId } = await threadWithQuestion();

    const result = await service.appendUserMessageAndCreateRun(
      "agency-1",
      thread.id,
      "user-1",
      "Transport: Public transit\nTrip length: 4 days",
      undefined,
      undefined,
      answersFor(questionId)
    );

    expect(result.message.metadata).toEqual({
      answers: {
        messageId: questionId,
        items: [
          { questionId: "q1", header: "Transport", question: "How will the travelers get around?", selected: ["Public transit"] },
          { questionId: "q2", header: "Trip length", question: "How many days should I plan?", selected: [], other: "4 days" }
        ]
      }
    });
    expect(result.run.status).toBe("QUEUED");
  });

  it("refuses an answer that is not one of the options", async () => {
    const { service, thread, questionId } = await threadWithQuestion();

    await expect(
      service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Transport: Boat", undefined, undefined, {
        messageId: questionId,
        items: [
          { questionId: "q1", selected: ["Boat"] },
          { questionId: "q2", selected: ["3 days"] }
        ]
      })
    ).rejects.toMatchObject({ code: "ASK_USER_ANSWERS_INVALID", statusCode: 400 });
  });

  it("refuses a second answer to the same question", async () => {
    const { service, thread, questionId } = await threadWithQuestion();
    await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "First", undefined, undefined, answersFor(questionId));

    await expect(
      service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Second", undefined, undefined, answersFor(questionId))
    ).rejects.toMatchObject({ code: "QUESTION_NOT_PENDING", statusCode: 409 });
  });

  it("refuses answers to a reply that asked nothing", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Kyoto" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Plan Kyoto");
    const { message } = await service.completeRun(run.id, "Here is the plan.");

    await expect(
      service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Answer", undefined, undefined, answersFor(message.id))
    ).rejects.toMatchObject({ code: "QUESTION_NOT_PENDING", statusCode: 409 });
  });
});
```

- [ ] **Step 2: Write the failing repository and schema tests**

Append to `tests/agentAskUserRepository.test.ts`:

```ts
describe("createUserMessageAndRun with answers", () => {
  const base = {
    threadId: "thread-1",
    agencyId: "agency-1",
    authorUserId: "user-1",
    content: "Transport: Public transit",
    metadata: { answers: { messageId: "message-1", items: [] } },
    modelProvider: "fake",
    modelName: "fake-model"
  };

  it("saves the answer while its question is the newest chat message", async () => {
    const { tx, client } = createTx("message-1");

    await createPrismaAgentRepository(client).createUserMessageAndRun({ ...base, answersTo: "message-1" });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.agentMessage.findFirst).toHaveBeenCalledWith({
      where: { threadId: "thread-1", role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    expect(tx.agentMessage.create).toHaveBeenCalledTimes(1);
    expect(tx.agentRun.create).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer once a newer message exists", async () => {
    const { tx, client } = createTx("message-2");

    await expect(
      createPrismaAgentRepository(client).createUserMessageAndRun({ ...base, answersTo: "message-1" })
    ).rejects.toMatchObject({ code: "QUESTION_NOT_PENDING", statusCode: 409 });
    expect(tx.agentMessage.create).not.toHaveBeenCalled();
  });

  it("does not lock or check for an ordinary message", async () => {
    const { tx, client } = createTx("message-2");

    await createPrismaAgentRepository(client).createUserMessageAndRun({ ...base, metadata: undefined });

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.agentMessage.findFirst).not.toHaveBeenCalled();
  });
});
```

Add this import to `tests/askUser.test.ts`, then append the test after it:

```ts
import { createMessageSchema } from "../src/modules/agent/agentSchemas";
```

```ts
describe("message schema answers", () => {
  it("accepts answers on a new message", () => {
    const parsed = createMessageSchema.parse({
      content: "Transport: Walking",
      answers: { messageId: "message-2", items: [{ questionId: "q1", selected: ["Walking"] }] }
    });

    expect(parsed.answers?.items[0].selected).toEqual(["Walking"]);
  });

  it("rejects unknown keys inside an answer", () => {
    expect(() =>
      createMessageSchema.parse({
        content: "Transport: Walking",
        answers: { messageId: "message-2", items: [{ questionId: "q1", selected: [], header: "Transport" }] }
      })
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/agentService.test.ts tests/agentAskUserRepository.test.ts tests/askUser.test.ts`
Expected: FAIL. The schema rejects the `answers` key, and the repository ignores `answersTo`.

- [ ] **Step 4: Add answers to the message schema**

In `Voyage-Server/src/modules/agent/agentSchemas.ts`, add `import { askUserAnswersSchema } from "./askUser";` below the `travelerNeeds` import. Then replace:

```ts
export const createMessageSchema = z.object({
  content: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1).max(12000)),
  imageUrls: z.array(z.string().url()).max(3).optional(),
  travelerNeeds: travelerNeedsSchema.optional()
}).strict();
```

with:

```ts
export const createMessageSchema = z.object({
  content: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1).max(12000)),
  imageUrls: z.array(z.string().url()).max(3).optional(),
  travelerNeeds: travelerNeedsSchema.optional(),
  answers: askUserAnswersSchema.optional()
}).strict();
```

- [ ] **Step 5: Add answersTo to the repository type**

In `Voyage-Server/src/modules/agent/agentTypes.ts`, inside `AgentRepository.createUserMessageAndRun`'s `data` type, replace:

```ts
    content: string;
    metadata?: unknown;
    travelerNeeds?: TravelerNeeds;
```

with:

```ts
    content: string;
    metadata?: unknown;
    /** Id of the assistant reply whose questions this message answers. */
    answersTo?: string;
    travelerNeeds?: TravelerNeeds;
```

- [ ] **Step 6: Validate answers in the service**

In `Voyage-Server/src/modules/agent/agentService.ts`:
- Add `AgentMessageRecord` to the `import type { ... } from "./agentTypes";` list.
- Replace the `import { ASK_USER_TOOL_NAME } from "./askUser";` line with:

```ts
import {
  ASK_USER_TOOL_NAME,
  parseStoredAskUser,
  questionNotPendingError,
  resolveAskUserAnswers,
  type AskUserAnswersInput
} from "./askUser";
```

Add this function just above `const TERMINAL_RUN_STATUSES`:

```ts
/** The questions being answered must be an assistant reply in this thread that asked them. */
function resolveAnswersForThread(messages: AgentMessageRecord[], answers: AskUserAnswersInput) {
  const question = messages.find((message) => message.id === answers.messageId && message.role === "ASSISTANT");
  const askUser = question ? parseStoredAskUser(question.metadata) : null;
  if (!askUser) throw questionNotPendingError();
  return resolveAskUserAnswers(askUser, answers);
}
```

Replace the start of `appendUserMessageAndCreateRun`:

```ts
    async appendUserMessageAndCreateRun(
      agencyId: string,
      threadId: string,
      userId: string,
      content: string,
      imageUrls?: string[],
      travelerNeeds?: TravelerNeeds
    ) {
      const parsed = createMessageSchema.parse({ content, imageUrls, travelerNeeds });
      await this.getThread(agencyId, threadId);
      const metadata = parsed.imageUrls?.length ? { imageUrls: parsed.imageUrls } : undefined;
      const result = await options.repository.createUserMessageAndRun({
        agencyId,
        threadId,
        authorUserId: userId,
        content: parsed.content,
        metadata,
        travelerNeeds: parsed.travelerNeeds,
```

with:

```ts
    async appendUserMessageAndCreateRun(
      agencyId: string,
      threadId: string,
      userId: string,
      content: string,
      imageUrls?: string[],
      travelerNeeds?: TravelerNeeds,
      answers?: AskUserAnswersInput
    ) {
      const parsed = createMessageSchema.parse({ content, imageUrls, travelerNeeds, answers });
      const thread = await this.getThread(agencyId, threadId);
      const storedAnswers = parsed.answers ? resolveAnswersForThread(thread.messages, parsed.answers) : undefined;
      const metadata = {
        ...(parsed.imageUrls?.length ? { imageUrls: parsed.imageUrls } : {}),
        ...(storedAnswers ? { answers: storedAnswers } : {})
      };
      const result = await options.repository.createUserMessageAndRun({
        agencyId,
        threadId,
        authorUserId: userId,
        content: parsed.content,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        ...(storedAnswers ? { answersTo: storedAnswers.messageId } : {}),
        travelerNeeds: parsed.travelerNeeds,
```

- [ ] **Step 7: Check that the question is still open, inside the transaction**

In `Voyage-Server/src/modules/agent/agentRepository.ts`, add `import { questionNotPendingError } from "./askUser";` below the `hasTravelerNeeds` import. Then replace:

```ts
    async createUserMessageAndRun(data) {
      return client.$transaction(async (tx) => {
        if (data.travelerNeeds !== undefined) {
```

with:

```ts
    async createUserMessageAndRun(data) {
      return client.$transaction(async (tx) => {
        if (data.answersTo) {
          // One answer per question: serialize answers on this thread and accept one
          // only while its question is still the newest chat message. Without this a
          // second tab could answer the same question and start a second run.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`answers:${data.threadId}`})::bigint)`;
          const latest = await tx.agentMessage.findFirst({
            where: { threadId: data.threadId, role: { in: ["USER", "ASSISTANT"] } },
            orderBy: { createdAt: "desc" },
            select: { id: true }
          });
          if (latest?.id !== data.answersTo) {
            throw questionNotPendingError();
          }
        }
        if (data.travelerNeeds !== undefined) {
```

- [ ] **Step 8: Mirror the check in the memory repository**

In `tests/agentService.test.ts`, replace the memory repository's:

```ts
    async createUserMessageAndRun(data) {
      const message = await this.createMessage({
        threadId: data.threadId,
        authorUserId: data.authorUserId,
        role: "USER",
        content: data.content
      });
```

with:

```ts
    async createUserMessageAndRun(data) {
      if (data.answersTo) {
        const latest = messages
          .filter((message) => message.threadId === data.threadId && (message.role === "USER" || message.role === "ASSISTANT"))
          .at(-1);
        if (latest?.id !== data.answersTo) {
          throw new ApiError(409, "QUESTION_NOT_PENDING", "This question was already answered.");
        }
      }
      const message = await this.createMessage({
        threadId: data.threadId,
        authorUserId: data.authorUserId,
        role: "USER",
        content: data.content,
        metadata: data.metadata
      });
```

- [ ] **Step 9: Pass answers from the controller**

In `Voyage-Server/src/modules/agent/agentController.ts`, inside `createMessage`, replace:

```ts
      input.imageUrls,
      input.travelerNeeds
    );
```

with:

```ts
      input.imageUrls,
      input.travelerNeeds,
      input.answers
    );
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/agentService.test.ts tests/agentAskUserRepository.test.ts tests/askUser.test.ts tests/agentTaskTools.test.ts tests/agentTaskRepository.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/modules/agent/agentSchemas.ts src/modules/agent/agentService.ts src/modules/agent/agentRepository.ts src/modules/agent/agentTypes.ts src/modules/agent/agentController.ts tests/agentService.test.ts tests/agentAskUserRepository.test.ts tests/askUser.test.ts
git commit -m "feat(agent): accept answers to ask_user questions"
```

---

## Task S5: The orchestrator ends the run on ask_user

**Files:**
- Modify: `Voyage-Server/src/modules/agent/agentOrchestrator.ts`
- Modify and test: `Voyage-Server/tests/agentOrchestrator.test.ts`

- [ ] **Step 1: Let the fake service record completion options**

In `tests/agentOrchestrator.test.ts`, inside `createFakeAgentService`, replace:

```ts
  const completeRunCalls: Array<{ runId: string; assistantContent: string; usage: unknown }> = [];
```

with:

```ts
  const completeRunCalls: Array<{ runId: string; assistantContent: string; usage: unknown; options?: any }> = [];
```

and replace:

```ts
    async completeRun(runId, assistantContent, usage) {
      completeRunCalls.push({ runId, assistantContent, usage });
      run.status = "COMPLETED";
      run.completedAt = new Date("2026-04-28T00:00:00.000Z");
      events.push({
        type: "message.completed",
        payload: { messageId: "message-1", content: assistantContent }
      });
```

with:

```ts
    async completeRun(runId, assistantContent, usage, options) {
      completeRunCalls.push({ runId, assistantContent, usage, ...(options ? { options } : {}) });
      run.status = "COMPLETED";
      run.completedAt = new Date("2026-04-28T00:00:00.000Z");
      events.push({
        type: "message.completed",
        payload: {
          messageId: "message-1",
          content: assistantContent,
          ...(options?.askUser ? { askUser: options.askUser } : {})
        }
      });
```

- [ ] **Step 2: Write the failing tests**

Add `createAskUserTool,` to the existing import list from `"../src/modules/agent/agentTools"`. Add this import:

```ts
import { ASK_USER_RESUME_BLOCK, DEFAULT_ASK_USER_LEAD_IN, normalizeAskUserInput } from "../src/modules/agent/askUser";
```

Append to the end of the file:

```ts
describe("ask_user", () => {
  const askCall = JSON.stringify({
    tool: "ask_user",
    questions: [
      { header: "Transport", question: "How will the travelers get around?", options: ["Private car", "Public transit"] },
      { header: "Trip length", question: "How many days should I plan?", options: ["2 days", "3 days"] }
    ]
  });

  function createAskOrchestrator(
    service: AgentOrchestratorAgentService,
    provider: ModelProvider,
    extra: Partial<Parameters<typeof createAgentOrchestrator>[0]> = {}
  ) {
    return createAgentOrchestrator({
      modelProvider: provider,
      agentService: service,
      availableToolNames: ["ask_user", "record_agent_task"],
      toolRegistry: createAgentToolRegistry([createAskUserTool(), createRecordAgentTaskTool({ agentService: service as any })]),
      ...extra
    });
  }

  it("ends the run with the questions as the reply and no synthesis pass", async () => {
    const { service, events, run, completeRunCalls } = createFakeAgentService();
    const provider = createModelProvider([`${askCall}\nA couple of details before I draft the itinerary.`, "SYNTHESIS SHOULD NOT RUN"]);

    await createAskOrchestrator(service, provider).run(createRunInput());

    expect(run.status).toBe("COMPLETED");
    expect(provider.calls).toHaveLength(1);
    expect(completeRunCalls).toHaveLength(1);
    expect(completeRunCalls[0].assistantContent).toBe("A couple of details before I draft the itinerary.");
    expect(completeRunCalls[0].options.askUser.questions.map((question: any) => question.id)).toEqual(["q1", "q2"]);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "message.delta",
      "message.completed",
      "run.completed"
    ]);
  });

  it("uses a default sentence when the model writes none", async () => {
    const { service, completeRunCalls } = createFakeAgentService();

    await createAskOrchestrator(service, createModelProvider(askCall)).run(createRunInput());

    expect(completeRunCalls[0].assistantContent).toBe(DEFAULT_ASK_USER_LEAD_IN);
  });

  it("can ask mid-build: stops the loop, skips synthesis, and still enriches the draft", async () => {
    const { service, completeRunCalls, tasks } = createFakeAgentService();
    service.getThread = async () =>
      ({
        messages: [{ role: "USER", content: "Plan Kyoto" }],
        events: [
          {
            type: "tool.completed",
            payload: {
              name: "create_itinerary",
              output: { itinerary: { id: "itinerary-1", days: [{ id: "day-1", dayNumber: 1, title: "Day 1", items: [] }] } }
            }
          }
        ]
      }) as any;
    const onBeforeRunComplete = vi.fn(async () => {});
    const provider = createModelProvider([
      '{"tool": "record_agent_task", "label": "Drafting Kyoto", "status": "RUNNING"}',
      `${askCall}\nDay 3 looks rainy, so one question first.`,
      "SYNTHESIS SHOULD NOT RUN"
    ]);

    await createAskOrchestrator(service, provider, { onBeforeRunComplete }).run(createRunInput());

    expect(tasks).toHaveLength(1);
    expect(provider.calls).toHaveLength(2);
    expect(completeRunCalls[0].assistantContent).toBe("Day 3 looks rainy, so one question first.");
    expect(onBeforeRunComplete).toHaveBeenCalledTimes(1);
  });

  it("skips tool calls that come after ask_user in the same reply", async () => {
    const { service, tasks, completeRunCalls } = createFakeAgentService();
    const provider = createModelProvider(
      JSON.stringify({
        assistantMessage: "Quick check first.",
        toolCalls: [
          { name: "ask_user", input: { questions: JSON.parse(askCall).questions } },
          { name: "record_agent_task", input: { label: "Should not run", status: "RUNNING" } }
        ]
      })
    );

    await createAskOrchestrator(service, provider).run(createRunInput());

    expect(tasks).toHaveLength(0);
    expect(completeRunCalls[0].assistantContent).toBe("Quick check first.");
  });

  it("lets the model fix an invalid ask_user call", async () => {
    const { service, completeRunCalls } = createFakeAgentService();
    const provider = createModelProvider([
      '{"tool": "ask_user", "question": "Car or train?", "options": ["Car"]}',
      `${askCall}\nTwo quick questions.`
    ]);

    await createAskOrchestrator(service, provider).run(createRunInput());

    expect(provider.calls[1].messages.at(-1)?.content).toContain("AGENT_TOOL_INPUT_INVALID");
    expect(completeRunCalls[0].assistantContent).toBe("Two quick questions.");
    expect(completeRunCalls[0].options.askUser.questions).toHaveLength(2);
  });

  it("shows the model what it asked and tells it to carry on after the answer", async () => {
    const { service } = createFakeAgentService();
    const askUser = normalizeAskUserInput(JSON.parse(askCall));
    service.getThread = async () => ({
      messages: [
        { role: "USER", content: "Plan Kyoto" },
        { role: "ASSISTANT", content: "A couple of details first.", metadata: { askUser } },
        {
          role: "USER",
          content: "Transport: Public transit\nTrip length: 3 days",
          metadata: { answers: { messageId: "message-2", items: [] } }
        }
      ]
    });
    const provider = createModelProvider("Thanks, drafting now.");

    await createAskOrchestrator(service, provider).run(createRunInput());

    const messages = provider.calls[0].messages;
    const asked = messages.find((message) => message.role === "assistant");
    expect(asked?.content).toBe(
      `${JSON.stringify({ tool: "ask_user", questions: askUser.questions.map(({ id, ...rest }) => rest) })}\nA couple of details first.`
    );
    expect(messages.at(-1)?.content).toContain(ASK_USER_RESUME_BLOCK);
  });

  it("does not add the resume hint to an ordinary message", async () => {
    const { service } = createFakeAgentService();
    const provider = createModelProvider("Hello.");

    await createAskOrchestrator(service, provider).run(createRunInput());

    expect(provider.calls[0].messages.at(-1)?.content).not.toContain(ASK_USER_RESUME_BLOCK);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/agentOrchestrator.test.ts -t "ask_user"`
Expected: FAIL. The run goes on to a synthesis call, and `completeRunCalls[0].options` is undefined.

- [ ] **Step 4: Import the contract helpers**

In `Voyage-Server/src/modules/agent/agentOrchestrator.ts`, below `import { overlayPlaceAdvisories } from "../itineraries/savedPlaceAdvisories";`, add:

```ts
import {
  ASK_USER_RESUME_BLOCK,
  ASK_USER_TOOL_NAME,
  askUserLeadIn,
  assistantHistoryContent,
  hasAskUserAnswers,
  type AskUserPayload
} from "./askUser";
```

- [ ] **Step 5: Let streamAndComplete pass the questions**

Replace:

```ts
  async function streamAndComplete(
    run: AgentRunRecord,
    assistantMessage: string,
    usageSummary: ReturnType<ReturnType<typeof createUsageAccumulator>["summary"]>
  ) {
    await options.agentService.recordRunEvent(run, {
      type: "message.delta",
      payload: { delta: assistantMessage }
    });
    await options.agentService.completeRun(run.id, assistantMessage, usageSummary);
  }
```

with:

```ts
  async function streamAndComplete(
    run: AgentRunRecord,
    assistantMessage: string,
    usageSummary: ReturnType<ReturnType<typeof createUsageAccumulator>["summary"]>,
    askUser?: AskUserPayload
  ) {
    await options.agentService.recordRunEvent(run, {
      type: "message.delta",
      payload: { delta: assistantMessage }
    });
    if (askUser) {
      await options.agentService.completeRun(run.id, assistantMessage, usageSummary, { askUser });
    } else {
      await options.agentService.completeRun(run.id, assistantMessage, usageSummary);
    }
  }
```

- [ ] **Step 6: Track answered questions, and add the enrichment helper**

Replace:

```ts
        // Per-thread traveler needs, formatted once per run for the runtime context.
        let travelerNeedsBlock = "";
```

with:

```ts
        // Per-thread traveler needs, formatted once per run for the runtime context.
        let travelerNeedsBlock = "";
        // True when the triggering message answers ask_user questions.
        let answeredQuestions = false;
```

Find the end of `refreshActiveItinerary`:

```ts
            return withLiveItinerary(context, live);
          } catch (error) {
            console.error("[Agent] Failed to load the live itinerary; using the thread's snapshot.", error);
            return context;
          }
        }
```

Add this directly after it:

```ts

        /** Photos and ratings land in the DB before the client re-fetches on completion. */
        async function enrichBeforeComplete() {
          if (activeItineraryContext?.itinerary && options.onBeforeRunComplete) {
            try { await options.onBeforeRunComplete(activeItineraryContext.itinerary); } catch { /* best-effort */ }
          }
        }
```

- [ ] **Step 7: Show asked questions in history and detect answers**

Replace:

```ts
          const recentMessages = (thread as any).messages.slice(-historyMessageLimit);
          conversationHistory = recentMessages
            .map((message: any) => {
              if (message.role === "USER") {
                return { role: "user" as const, content: message.content };
              }
              if (message.role === "ASSISTANT") {
                return { role: "assistant" as const, content: message.content };
              }
```

with:

```ts
          const recentMessages = (thread as any).messages.slice(-historyMessageLimit);
          // The newest user message triggered this run; if it answers ask_user
          // questions, the agent is told to carry on with the work it paused.
          const triggerMessage = [...recentMessages].reverse().find((message: any) => message.role === "USER");
          answeredQuestions = hasAskUserAnswers(triggerMessage?.metadata);
          conversationHistory = recentMessages
            .map((message: any) => {
              if (message.role === "USER") {
                return { role: "user" as const, content: message.content };
              }
              if (message.role === "ASSISTANT") {
                return { role: "assistant" as const, content: assistantHistoryContent(message.content, message.metadata) };
              }
```

Replace:

```ts
          const initialRuntimeContext = [
            buildRuntimeContextBlock(activeItineraryContext, await currentPlaceAdvisoryBlock()),
            travelerNeedsBlock,
            buildRunDateBlock(now()),
            taskBlock
          ].filter(Boolean).join("\n\n---\n\n");
```

with:

```ts
          const initialRuntimeContext = [
            buildRuntimeContextBlock(activeItineraryContext, await currentPlaceAdvisoryBlock()),
            travelerNeedsBlock,
            buildRunDateBlock(now()),
            taskBlock,
            answeredQuestions ? ASK_USER_RESUME_BLOCK : ""
          ].filter(Boolean).join("\n\n---\n\n");
```

- [ ] **Step 8: Make ask_user end the batch and the loop**

Replace:

```ts
        // Set when the tool loop must end now and go straight to synthesis.
        let stopToolLoop = false;
```

with:

```ts
        // Set when the tool loop must end now and go straight to synthesis.
        let stopToolLoop = false;
        // Set when the agent calls ask_user: the run ends with these questions as its reply.
        const asked: { payload: AskUserPayload | null; leadIn: string } = { payload: null, leadIn: "" };
```

In `executeToolCallsBatch`, replace:

```ts
              await Promise.all([
                options.agentService.completeToolCall(persistedToolCall.id, output, now()),
                options.agentService.recordRunEvent(run, {
                  type: "tool.completed",
                  payload: { name: toolCall.name, output }
                })
              ]);
            } catch (error) {
```

with:

```ts
              await Promise.all([
                options.agentService.completeToolCall(persistedToolCall.id, output, now()),
                options.agentService.recordRunEvent(run, {
                  type: "tool.completed",
                  payload: { name: toolCall.name, output }
                })
              ]);
              if (toolCall.name === ASK_USER_TOOL_NAME) {
                // Asking ends the turn: later calls in this reply are skipped and the loop stops.
                asked.payload = output as AskUserPayload;
                stopToolLoop = true;
                return;
              }
            } catch (error) {
```

Replace the first batch call:

```ts
        try {
          await executeToolCallsBatch(parsedOutput.toolCalls);
        } catch (error) {
          if (signal?.aborted) { agentLogger.debug(input.runId, "Run cancelled by user"); return; }
          await failRun(input, error);
          return;
        }
```

with:

```ts
        try {
          await executeToolCallsBatch(parsedOutput.toolCalls);
        } catch (error) {
          if (signal?.aborted) { agentLogger.debug(input.runId, "Run cancelled by user"); return; }
          await failRun(input, error);
          return;
        }
        if (asked.payload) {
          asked.leadIn = askUserLeadIn(parsedOutput.assistantMessage);
        }
```

Replace the continuation batch call:

```ts
          try {
            await executeToolCallsBatch(nextParsed.toolCalls);
          } catch (error) {
            if (signal?.aborted) { agentLogger.debug(input.runId, "Run cancelled by user"); return; }
            await failRun(input, error);
            return;
          }
```

with:

```ts
          try {
            await executeToolCallsBatch(nextParsed.toolCalls);
          } catch (error) {
            if (signal?.aborted) { agentLogger.debug(input.runId, "Run cancelled by user"); return; }
            await failRun(input, error);
            return;
          }
          if (asked.payload) {
            asked.leadIn = askUserLeadIn(nextParsed.assistantMessage);
            break;
          }
```

- [ ] **Step 9: Complete with the questions and skip synthesis**

Replace:

```ts
        // Update the assistantMessage seed used by synthesis to the last continuation if we ran one.
        parsedOutput = { ...parsedOutput, assistantMessage: lastAssistantMessage };

        if (toolResults.length === 0) {
```

with:

```ts
        // Update the assistantMessage seed used by synthesis to the last continuation if we ran one.
        parsedOutput = { ...parsedOutput, assistantMessage: lastAssistantMessage };

        if (asked.payload) {
          // The questions are the reply, so there is no synthesis pass.
          await enrichBeforeComplete();
          await streamAndComplete(run, asked.leadIn, usage.summary(), asked.payload);
          return;
        }

        if (toolResults.length === 0) {
```

Replace:

```ts
        // Enrich PlaceSnapshots (photos, ratings) BEFORE completing the run
        // so the client's post-completion re-fetch gets fully populated data.
        if (activeItineraryContext?.itinerary && options.onBeforeRunComplete) {
          try { await options.onBeforeRunComplete(activeItineraryContext.itinerary); } catch { /* best-effort */ }
        }
```

with:

```ts
        // Enrich PlaceSnapshots (photos, ratings) BEFORE completing the run
        // so the client's post-completion re-fetch gets fully populated data.
        await enrichBeforeComplete();
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/agentOrchestrator.test.ts`
Expected: PASS. That includes every existing orchestrator test.

- [ ] **Step 11: Commit**

```bash
git add src/modules/agent/agentOrchestrator.ts tests/agentOrchestrator.test.ts
git commit -m "feat(agent): end the run when the agent asks the user"
```

---

## Task S6: Prompt rules

**Files:**
- Modify: `Voyage-Server/src/modules/agent/agentPrompts.ts`
- Test: `Voyage-Server/tests/askUserPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `Voyage-Server/tests/askUserPrompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildVoyageSystemPrompt } from "../src/modules/agent/agentPrompts";

describe("system prompt: asking the user", () => {
  const prompt = buildVoyageSystemPrompt("ask_user, plan_itinerary");

  it("describes ask_user and shows the call format", () => {
    expect(prompt).toContain("ask_user: ask the user 1-4 multiple-choice questions");
    expect(prompt).toContain('{"tool": "ask_user", "questions": [{"header": "Transport"');
    expect(prompt).toContain("Never write questions or option lists as markdown text");
  });

  it("no longer tells the agent to format questions as markdown bullets", () => {
    expect(prompt).not.toContain("Question Formatting (MARKDOWN REQUIRED)");
    expect(prompt).not.toContain("Ask only one clarifying question at a time.");
  });

  it("asks for transport mode through ask_user before planning", () => {
    expect(prompt).toContain("If the user has not stated transport mode, call ask_user");
  });

  it("stays identical across calls so the system prompt can be cached", () => {
    expect(buildVoyageSystemPrompt("ask_user, plan_itinerary")).toBe(prompt);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/askUserPrompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit the prompt**

In `Voyage-Server/src/modules/agent/agentPrompts.ts`, inside `buildVoyageSystemPrompt`, make these edits.

**(a)** Add the tool's role. Replace:

```ts
    "weather_forecast: daily weather for a place and date range - a real forecast up to about 15 days ahead (with hour-by-hour timing), typical weather from past years for later dates.",
```

with:

```ts
    "weather_forecast: daily weather for a place and date range - a real forecast up to about 15 days ahead (with hour-by-hour timing), typical weather from past years for later dates.",
    "ask_user: ask the user 1-4 multiple-choice questions; their chat box turns into a picker. Calling it ends your turn, and the answers arrive as the user's next message.",
```

**(b)** In the string that starts with `"Trip planning or itinerary drafting (NEW DRAFT): follow the Itinerary Planning Intelligence section below.`, replace `Clarify transport mode if unknown, then brainstorm` with `If transport mode is unknown, ask with ask_user and wait for the answer; then brainstorm`. The full line becomes:

```ts
    "Trip planning or itinerary drafting (NEW DRAFT): follow the Itinerary Planning Intelligence section below. If transport mode is unknown, ask with ask_user and wait for the answer; then brainstorm and cluster candidate places from your training knowledge (no search tools for well-known destinations), call plan_itinerary with day themes matching those clusters, then loop add_itinerary_item once per stop. Send exactly one tool call per response, but DO NOT stop after the first tool call - keep going until every day is filled to the target density. After the final add_itinerary_item, return a brief plain-text summary with no tool call.",
```

**(c)** Replace:

```ts
    "Ambiguous place request: ask one clarifying question before using a tool when the place could mean several countries, cities, businesses, landmarks, or category searches.",
```

with:

```ts
    "Ambiguous place request: call ask_user before using a tool when the place could mean several countries, cities, businesses, landmarks, or category searches.",
```

**(d)** Replace the `"Transport Mode: ...` line with:

```ts
    "Transport Mode: Before planning a NEW draft, identify how the travelers will move between stops. If the user has not stated transport mode, call ask_user and wait for the answer before calling plan_itinerary; put any other missing essentials, such as trip length or pace, into the same call. Once known, pass the matching travelMode to estimate_route: car -> 'DRIVE', public transit -> 'TRANSIT', walking -> 'WALK', mixed -> pick the dominant mode for the segment.",
```

**(e)** In "Clarification Rules", replace every line from `"Ask only one clarifying question at a time.",` through `"Single-option questions (no list needed) may stay as a single short sentence with a bolded key term, e.g. **Which city** are we planning around?",`. That range includes the `"Do not ask for clarification ..."` line and all the "Question Formatting (MARKDOWN REQUIRED)" lines and their examples. The replacement is:

```ts
    "Ask once: put everything you need into a single ask_user call (up to 4 questions).",
    "Do not ask for clarification when the obvious interpretation is strong enough and low-risk.",
    "",
    "Asking the User (ask_user)",
    "Whenever you need information or a decision from the user, call ask_user. Never write questions or option lists as markdown text; the chat box only turns into a picker for ask_user.",
    "Each question needs a short header (at most 16 characters, shown as a chip), the question itself, and 2-4 options. Give each option a short label (at most 40 characters) and, when it helps, a one-line description. Set multiSelect to true only when several options can apply together, such as interests.",
    "Do not add an 'Other' option: the user can always type their own answer.",
    "Calling ask_user ends your turn. Put no other tool call in that response. After the JSON, write one or two sentences for the chat: what you have done so far, if anything, and why you are asking.",
    "Mid-build questions: while building or editing an itinerary, call ask_user only when a decision really needs the user, for example rain on a day with a must-do outdoor stop, or two equally good options that change the plan. Stops already added stay saved, and you will continue from the current draft after the answer.",
    "When the user's latest message answers your questions, continue the work. Do not ask the same questions again.",
```

**(f)** In "Tool Call Format", replace:

```ts
    'Example: {"tool": "weather_forecast", "placeName": "Baguio City", "cityContext": "Benguet, Philippines", "startDate": "2026-10-10", "endDate": "2026-10-12"}',
```

with:

```ts
    'Example: {"tool": "weather_forecast", "placeName": "Baguio City", "cityContext": "Benguet, Philippines", "startDate": "2026-10-10", "endDate": "2026-10-12"}',
    'Example (one question): {"tool": "ask_user", "questions": [{"header": "Transport", "question": "How will the travelers get around?", "options": [{"label": "Private car", "description": "Most stops per day"}, {"label": "Public transit", "description": "Fewer stops, station-friendly"}, {"label": "Walking"}, {"label": "A mix"}]}]} A couple of details before I draft the itinerary.',
    'Example (bundled questions, one multi-select): {"tool": "ask_user", "questions": [{"header": "Trip length", "question": "How many days should I plan?", "options": [{"label": "2 days"}, {"label": "3 days"}, {"label": "5 days"}]}, {"header": "Interests", "question": "What should the days focus on?", "multiSelect": true, "options": [{"label": "Food"}, {"label": "Museums"}, {"label": "Nature"}, {"label": "Shopping"}]}]}',
```

- [ ] **Step 4: Run the prompt tests to verify they pass**

Run: `npx vitest run tests/askUserPrompt.test.ts tests/travelerNeeds.test.ts tests/weatherTool.test.ts tests/transitPreference.test.ts`
Expected: PASS. The other three files also assert prompt text, so this confirms nothing they check was removed.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/agentPrompts.ts tests/askUserPrompt.test.ts
git commit -m "feat(agent): tell the agent to ask through ask_user"
```

---

## Task S7: Server verification

**Files:** none.

- [ ] **Step 1: Run the full suite and the build**

Run: `npm test 2>&1 | tail -20`, then `npm run build`.
Expected: the build succeeds. No test file fails that wasn't already failing in Task 0.

- [ ] **Step 2: Fix any regressions**

If a test that passed in Task 0 now fails, fix it in the task that caused it, then commit with `fix(agent): ...`.

---

## Task C1: Client ask_user helpers

**Files:**
- Create: `Voyage-Client/app/lib/agent/askUser.js`
- Test: `Voyage-Client/tests/ask-user-helpers.test.js`

- [ ] **Step 1: Write the failing tests**

Create `Voyage-Client/tests/ask-user-helpers.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  answerText,
  askUserStatuses,
  buildAnswer,
  emptyDraft,
  findPendingQuestion,
  getAnswers,
  getAskUser,
  isAnswered,
} from "../app/lib/agent/askUser.js";

const questions = [
  { id: "q1", header: "Transport", question: "How will the travelers get around?", multiSelect: false, options: [{ label: "Private car" }, { label: "Public transit" }] },
  { id: "q2", header: "Interests", question: "What should the days focus on?", multiSelect: true, options: [{ label: "Food" }, { label: "Museums" }] },
];
const asking = { id: "m-2", role: "assistant", content: "A couple of details first.", metadata: { askUser: { questions } } };
const answer = {
  id: "m-3",
  role: "user",
  content: "Transport: Public transit",
  metadata: { answers: { messageId: "m-2", items: [{ questionId: "q1", header: "Transport", selected: ["Public transit"] }] } },
};

describe("findPendingQuestion", () => {
  it("returns the questions while the asking reply is the newest message", () => {
    expect(findPendingQuestion([{ id: "m-1", role: "user", content: "Plan Kyoto" }, asking])).toEqual({ messageId: "m-2", questions });
  });

  it("closes once any later chat message exists", () => {
    expect(findPendingQuestion([asking, answer])).toBeNull();
    expect(findPendingQuestion([asking, { id: "m-4", role: "user", content: "Actually, plan Osaka" }])).toBeNull();
  });

  it("ignores system notes after the question", () => {
    expect(findPendingQuestion([asking, { id: "s-1", role: "system", content: "Reused 3 stops" }])).toEqual({ messageId: "m-2", questions });
  });

  it("returns null for replies without questions", () => {
    expect(findPendingQuestion([{ id: "m-1", role: "assistant", content: "Done." }])).toBeNull();
    expect(findPendingQuestion(undefined)).toBeNull();
  });
});

describe("askUserStatuses", () => {
  it("marks each asking reply pending, answered, or skipped", () => {
    const statuses = askUserStatuses([
      asking,
      answer,
      { ...asking, id: "m-5" },
      { id: "m-6", role: "user", content: "Never mind" },
      { ...asking, id: "m-7" },
    ]);

    expect(statuses.get("m-2")).toBe("answered");
    expect(statuses.get("m-5")).toBe("skipped");
    expect(statuses.get("m-7")).toBe("pending");
  });
});

describe("buildAnswer", () => {
  it("builds the API request, the bubble display, and the text the agent reads", () => {
    const draft = {
      ...emptyDraft(questions),
      q1: { selected: ["Public transit"], other: "" },
      q2: { selected: ["Food"], other: " Night markets " },
    };

    const result = buildAnswer({ messageId: "m-2", questions }, draft);

    expect(result.request).toEqual({
      messageId: "m-2",
      items: [
        { questionId: "q1", selected: ["Public transit"] },
        { questionId: "q2", selected: ["Food"], other: "Night markets" },
      ],
    });
    expect(result.display.items[1]).toMatchObject({ header: "Interests", question: "What should the days focus on?" });
    expect(result.text).toBe("Transport: Public transit\nInterests: Food, Night markets");
  });
});

describe("small helpers", () => {
  it("reads questions and answers only from the right roles", () => {
    expect(getAskUser(asking)).toBe(questions);
    expect(getAskUser({ ...asking, role: "user" })).toBeNull();
    expect(getAnswers(answer)).toBe(answer.metadata.answers);
    expect(getAnswers({ ...answer, role: "assistant" })).toBeNull();
  });

  it("treats a choice or typed text as an answer", () => {
    expect(isAnswered({ selected: [], other: "  " })).toBe(false);
    expect(isAnswered({ selected: ["Food"], other: "" })).toBe(true);
    expect(isAnswered({ selected: [], other: "Bike" })).toBe(true);
    expect(answerText({ selected: ["Food", "Museums"], other: "Night markets" })).toBe("Food, Museums, Night markets");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/ask-user-helpers.test.js`
Expected: FAIL. The module isn't found.

- [ ] **Step 3: Write the helpers**

Create `Voyage-Client/app/lib/agent/askUser.js`:

```js
/**
 * Helpers for the agent's ask_user questions: finding the open question, building
 * the answer the composer sends, and reading answers back for the chat history.
 */

function isChatMessage(message) {
  return message?.role === "user" || message?.role === "assistant";
}

function isQuestionList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((question) => question && typeof question.id === "string" && Array.isArray(question.options))
  );
}

/** The questions an assistant message asked, or null. */
export function getAskUser(message) {
  const questions = message?.metadata?.askUser?.questions;
  return message?.role === "assistant" && isQuestionList(questions) ? questions : null;
}

/** The answers a user message carries, or null. */
export function getAnswers(message) {
  const answers = message?.metadata?.answers;
  return message?.role === "user" && Array.isArray(answers?.items) && answers.items.length > 0 ? answers : null;
}

/**
 * The open question: only while the newest chat message is the assistant reply
 * that asked it. Any later user or assistant message closes it; system notes don't.
 */
export function findPendingQuestion(messages) {
  if (!Array.isArray(messages)) return null;
  const last = [...messages].reverse().find(isChatMessage);
  const questions = getAskUser(last);
  return questions ? { messageId: String(last.id), questions } : null;
}

/** "pending", "answered", or "skipped" for each reply that asked, keyed by message id. */
export function askUserStatuses(messages) {
  const statuses = new Map();
  if (!Array.isArray(messages)) return statuses;
  const chat = messages.filter(isChatMessage);
  chat.forEach((message, index) => {
    if (!getAskUser(message)) return;
    const next = chat[index + 1];
    if (!next) statuses.set(message.id, "pending");
    else statuses.set(message.id, getAnswers(next)?.messageId === String(message.id) ? "answered" : "skipped");
  });
  return statuses;
}

export function emptyDraft(questions) {
  return Object.fromEntries(questions.map((question) => [question.id, { selected: [], other: "" }]));
}

export function isAnswered(entry) {
  return Boolean(entry) && (entry.selected.length > 0 || entry.other.trim().length > 0);
}

/** One line of answer text: the chosen labels, then the typed answer. */
export function answerText(item) {
  return [...(item.selected ?? []), ...(item.other ? [item.other] : [])].join(", ");
}

/**
 * Build what the composer sends: `request` for the API, `display` for the
 * optimistic answer bubble, and `text` as the message the agent reads.
 */
export function buildAnswer(pending, draft) {
  const items = pending.questions.map((question) => {
    const entry = draft[question.id] ?? { selected: [], other: "" };
    const other = entry.other.trim();
    return { questionId: question.id, selected: [...entry.selected], ...(other ? { other } : {}) };
  });
  const display = {
    messageId: pending.messageId,
    items: items.map((item, index) => ({
      ...item,
      header: pending.questions[index].header,
      question: pending.questions[index].question,
    })),
  };
  const text = display.items.map((item) => `${item.header}: ${answerText(item)}`).join("\n");
  return { request: { messageId: pending.messageId, items }, display, text };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/ask-user-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (from `Voyage-Client`)

```bash
git add app/lib/agent/askUser.js tests/ask-user-helpers.test.js
git commit -m "feat(agent): add ask_user helpers for the composer and history"
```

---

## Task C2: Keep the reply's server id and questions

**Files:**
- Modify: `Voyage-Client/app/hooks/useAgentRunStream.js`, `Voyage-Client/app/hooks/useAgentStreamOrchestration.js`, `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`
- Test: `Voyage-Client/tests/useAgentRunStream.test.js`, create `Voyage-Client/tests/use-agent-stream-orchestration.test.jsx`

- [ ] **Step 1: Write the failing stream test**

Append to `tests/useAgentRunStream.test.js`:

```js
describe("useAgentRunStream — ask_user replies", () => {
  it("keeps the reply's server id and questions from message.completed, and clears them on the next run", () => {
    const { result } = renderHook(() => useAgentRunStream("agency-1"));
    const askUser = {
      questions: [{ id: "q1", header: "Transport", question: "Car or train?", multiSelect: false, options: [{ label: "Car" }, { label: "Train" }] }],
    };

    act(() => {
      result.current.startStream("run-1");
    });
    act(() => {
      mockEventSourceInstance.emit("message.completed", {
        type: "message.completed",
        payload: { messageId: "message-9", content: "One question first.", askUser },
      });
    });

    expect(result.current.completedMessageId).toBe("message-9");
    expect(result.current.completedMessageAskUser).toEqual(askUser);

    act(() => {
      result.current.startStream("run-2");
    });

    expect(result.current.completedMessageId).toBeNull();
    expect(result.current.completedMessageAskUser).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing commit test**

Create `Voyage-Client/tests/use-agent-stream-orchestration.test.jsx`:

```jsx
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/lib/api/index.js", () => ({ fetchItineraryDraft: vi.fn(async () => null) }));

import { useAgentStreamOrchestration } from "../app/hooks/useAgentStreamOrchestration.js";

const askUser = {
  questions: [{ id: "q1", header: "Transport", question: "Car or train?", multiSelect: false, options: [{ label: "Car" }, { label: "Train" }] }],
};

function renderCommit({ initialMessages = [{ id: "user-1", role: "user", content: "Plan Kyoto" }], ...overrides } = {}) {
  let state = { "draft-1": { messages: initialMessages, loaded: true } };
  const setDraftThreadStates = vi.fn((update) => {
    state = typeof update === "function" ? update(state) : update;
  });
  renderHook(() =>
    useAgentStreamOrchestration({
      agencyId: "agency-1",
      runStatus: "completed",
      completedMessageContent: "A couple of details first.",
      completedMessageProcess: null,
      completedMessageId: "message-9",
      completedMessageAskUser: askUser,
      assistantMessage: "A couple of details first.",
      lastItineraryUpdate: null,
      streamingItinerary: null,
      runTargetRef: { current: "draft:draft-1" },
      setTripStates: vi.fn(),
      setDraftThreadStates,
      ...overrides,
    }),
  );
  return () => state["draft-1"].messages;
}

describe("committing the finished reply", () => {
  it("uses the server id and keeps the questions on the message", () => {
    const messages = renderCommit();

    expect(messages().at(-1)).toMatchObject({
      id: "message-9",
      role: "assistant",
      content: "A couple of details first.",
      metadata: { askUser },
    });
  });

  it("still commits when an earlier reply had the same words", () => {
    const messages = renderCommit({
      initialMessages: [
        { id: "message-3", role: "assistant", content: "A couple of details first." },
        { id: "user-4", role: "user", content: "Something else" },
      ],
    });

    expect(messages().map((message) => message.id)).toEqual(["message-3", "user-4", "message-9"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/useAgentRunStream.test.js tests/use-agent-stream-orchestration.test.jsx`
Expected: FAIL. `completedMessageId` is undefined, and the message id starts with `assistant-`.

- [ ] **Step 4: Keep the values in the stream hook**

In `Voyage-Client/app/hooks/useAgentRunStream.js`, replace:

```js
  const [completedMessageProcess, setCompletedMessageProcess] = useState(null);
```

with:

```js
  const [completedMessageProcess, setCompletedMessageProcess] = useState(null);
  const [completedMessageId, setCompletedMessageId] = useState(null);
  const [completedMessageAskUser, setCompletedMessageAskUser] = useState(null);
```

In `startStream`, replace:

```js
    setCompletedMessageProcess(null);
```

with:

```js
    setCompletedMessageProcess(null);
    setCompletedMessageId(null);
    setCompletedMessageAskUser(null);
```

In the `message.completed` listener, replace:

```js
      // Capture the server-computed process snapshot if present.
      if (data.payload?.process != null) {
        setCompletedMessageProcess(data.payload.process);
      }
    });
```

with:

```js
      // Capture the server-computed process snapshot if present.
      if (data.payload?.process != null) {
        setCompletedMessageProcess(data.payload.process);
      }
      // The server's id for the reply, so answers to its questions can name it.
      if (typeof data.payload?.messageId === 'string') {
        setCompletedMessageId(data.payload.messageId);
      }
      // Questions the reply asked with ask_user (null for an ordinary reply).
      setCompletedMessageAskUser(data.payload?.askUser ?? null);
    });
```

In the returned object, replace:

```js
    completedMessageProcess,
    tasks,
```

with:

```js
    completedMessageProcess,
    completedMessageId,
    completedMessageAskUser,
    tasks,
```

- [ ] **Step 5: Commit with the server id**

In `Voyage-Client/app/hooks/useAgentStreamOrchestration.js`, replace:

```js
  completedMessageContent,
  completedMessageProcess,
  assistantMessage,
```

with:

```js
  completedMessageContent,
  completedMessageProcess,
  // The reply's server id and its ask_user questions, from message.completed.
  completedMessageId = null,
  completedMessageAskUser = null,
  assistantMessage,
```

In the commit effect, replace:

```js
      const current = prev[runTarget.id] || { messages: [], loaded: false };
      if (current.messages.some(m => m.role === "assistant" && m.content.trim() === finalContent)) return prev;
```

with:

```js
      const current = prev[runTarget.id] || { messages: [], loaded: false };
      // With a server id, match on it: two replies can share the same fallback sentence.
      const alreadyCommitted = completedMessageId
        ? current.messages.some((m) => m.id === completedMessageId)
        : current.messages.some((m) => m.role === "assistant" && m.content.trim() === finalContent);
      if (alreadyCommitted) return prev;
```

Replace:

```js
      const message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: finalContent,
        ...(itineraryId ? { itineraryId } : {}),
        ...(processSnapshot ? { process: processSnapshot } : {}),
      };
```

with:

```js
      const message = {
        // The server id matches what a reload returns and lets answers name this reply.
        id: completedMessageId ?? `assistant-${Date.now()}`,
        role: "assistant",
        content: finalContent,
        ...(itineraryId ? { itineraryId } : {}),
        ...(processSnapshot ? { process: processSnapshot } : {}),
        ...(completedMessageAskUser ? { metadata: { askUser: completedMessageAskUser } } : {}),
      };
```

Replace that effect's dependency list:

```js
  }, [runStatus, completedMessageContent, completedMessageProcess, assistantMessage, lastItineraryUpdate]);
```

with:

```js
  }, [runStatus, completedMessageContent, completedMessageProcess, completedMessageId, completedMessageAskUser, assistantMessage, lastItineraryUpdate]);
```

- [ ] **Step 6: Wire the values through HomePage**

In `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`, in the `useAgentRunStream` destructuring, replace:

```js
    completedMessageContent,
    completedMessageProcess,
    tasks,
```

with:

```js
    completedMessageContent,
    completedMessageProcess,
    completedMessageId,
    completedMessageAskUser,
    tasks,
```

In the `useAgentStreamOrchestration({ ... })` call, replace:

```js
    completedMessageContent,
    completedMessageProcess,
    assistantMessage,
```

with:

```js
    completedMessageContent,
    completedMessageProcess,
    completedMessageId,
    completedMessageAskUser,
    assistantMessage,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/useAgentRunStream.test.js tests/use-agent-stream-orchestration.test.jsx tests/home-page.test.jsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/hooks/useAgentRunStream.js app/hooks/useAgentStreamOrchestration.js app/components/trip-dashboard/HomePage.jsx tests/useAgentRunStream.test.js tests/use-agent-stream-orchestration.test.jsx
git commit -m "feat(agent): keep the reply's id and ask_user questions from the stream"
```

---

## Task C3: Keep message metadata after a reload

**Files:**
- Modify: `Voyage-Client/app/hooks/useTripPlanning.js`
- Test: `Voyage-Client/tests/thread-message-metadata.test.js`

- [ ] **Step 1: Write the failing test**

Create `Voyage-Client/tests/thread-message-metadata.test.js`:

```js
import { describe, expect, it } from "vitest";
import { normalizeThreadMessages } from "../app/hooks/useTripPlanning.js";

describe("reloaded message metadata", () => {
  it("keeps questions, answers, and image urls", () => {
    const askUser = {
      questions: [{ id: "q1", header: "Transport", question: "Car or train?", multiSelect: false, options: [{ label: "Car" }, { label: "Train" }] }],
    };
    const answers = { messageId: "a-1", items: [{ questionId: "q1", header: "Transport", question: "Car or train?", selected: ["Train"] }] };

    const messages = normalizeThreadMessages({
      messages: [
        { id: "u-1", role: "USER", content: "What is this?", metadata: { imageUrls: ["https://img/1.png"] } },
        { id: "a-1", role: "ASSISTANT", content: "One question first.", metadata: { askUser } },
        { id: "u-2", role: "USER", content: "Transport: Train", metadata: { answers } },
      ],
    });

    expect(messages[0].metadata).toEqual({ imageUrls: ["https://img/1.png"] });
    expect(messages[1].metadata).toEqual({ askUser });
    expect(messages[2].metadata).toEqual({ answers });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --pool=threads tests/thread-message-metadata.test.js`
Expected: FAIL. `metadata` is undefined.

- [ ] **Step 3: Keep the whole metadata object**

In `Voyage-Client/app/hooks/useTripPlanning.js`, inside `normalizeMessagesArray`, replace:

```js
        ...(message.metadata?.itineraryId ? { metadata: { itineraryId: message.metadata.itineraryId } } : {}),
```

with:

```js
        // Keep all of it: the chat reads ask_user questions and answers, and user images, from here.
        ...(message.metadata && typeof message.metadata === "object" ? { metadata: message.metadata } : {}),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/thread-message-metadata.test.js tests/thread-message-itinerary-link.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useTripPlanning.js tests/thread-message-metadata.test.js
git commit -m "fix(agent): keep message metadata when a thread reloads"
```

---

## Task C4: Send answers

**Files:**
- Modify: `Voyage-Client/app/lib/api/agent.js`, `Voyage-Client/app/hooks/useTripPlanning.js`
- Test: create `Voyage-Client/tests/ask-user-wire.test.js` and `Voyage-Client/tests/ask-user-dispatch.test.jsx`

- [ ] **Step 1: Write the failing API test**

Create `Voyage-Client/tests/ask-user-wire.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ fetchApi: vi.fn(async () => ({ runId: "run-1" })) }));

vi.mock("../app/lib/api/client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchApi: client.fetchApi,
}));

import { sendMessage } from "../app/lib/api/agent.js";

const bodyOf = () => JSON.parse(client.fetchApi.mock.calls[0][1].body);

beforeEach(() => {
  client.fetchApi.mockClear();
});

describe("sendMessage answers", () => {
  it("sends answers with the message", async () => {
    const answers = { messageId: "m-2", items: [{ questionId: "q1", selected: ["Train"] }] };

    await sendMessage("agency-1", "thread-1", "Transport: Train", [], null, answers);

    expect(bodyOf()).toEqual({ content: "Transport: Train", answers });
  });

  it("leaves answers out of an ordinary message", async () => {
    await sendMessage("agency-1", "thread-1", "Plan Cebu");

    expect(bodyOf()).toEqual({ content: "Plan Cebu" });
  });
});
```

- [ ] **Step 2: Write the failing dispatch tests**

Create `Voyage-Client/tests/ask-user-dispatch.test.jsx`:

```jsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  bootstrapAgentWorkspace: vi.fn(),
  createAgentThread: vi.fn(),
  fetchItineraryDraft: vi.fn(),
  fetchThreadMessages: vi.fn(async () => ({ messages: [] })),
  sendMessage: vi.fn(async () => ({ runId: "run-1" })),
  uploadChatImages: vi.fn(),
  updateAgentThreadTitle: vi.fn(),
}));

vi.mock("../app/lib/api/index.js", () => api);

import { useTripPlanning } from "../app/hooks/useTripPlanning.js";

const answers = {
  request: { messageId: "m-2", items: [{ questionId: "q1", selected: ["Train"] }] },
  display: { messageId: "m-2", items: [{ questionId: "q1", header: "Transport", question: "Car or train?", selected: ["Train"] }] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sending answers", () => {
  it("sends the answers and shows them on the optimistic message", async () => {
    api.createAgentThread.mockResolvedValue({ thread: { id: "thread-1", title: "", events: [] } });
    const { result } = renderHook(() => useTripPlanning("agency-1"));

    await act(async () => {
      await result.current.dispatchMessage("Transport: Train", vi.fn(), [], null, { answers });
    });

    expect(api.sendMessage).toHaveBeenCalledWith("agency-1", "thread-1", "Transport: Train", [], null, answers.request);
    expect(result.current.draftThreadStates["thread-1"].messages.at(-1)).toMatchObject({
      role: "user",
      content: "Transport: Train",
      metadata: { answers: answers.display },
    });
  });

  it("reloads the thread when the question was already answered elsewhere", async () => {
    api.createAgentThread.mockResolvedValue({ thread: { id: "thread-2", title: "", events: [] } });
    api.sendMessage.mockRejectedValueOnce(
      Object.assign(new Error("This question was already answered."), { code: "QUESTION_NOT_PENDING" }),
    );
    // Newest first, as the server returns them.
    api.fetchThreadMessages.mockResolvedValueOnce({
      messages: [
        { id: "u-3", role: "USER", content: "Transport: Car", metadata: { answers: { messageId: "m-2", items: [] } } },
        { id: "m-2", role: "ASSISTANT", content: "One question first." },
      ],
    });
    const { result } = renderHook(() => useTripPlanning("agency-1"));

    await act(async () => {
      await result.current.dispatchMessage("Transport: Train", vi.fn(), [], null, { answers });
    });

    expect(api.fetchThreadMessages).toHaveBeenCalledWith("agency-1", "thread-2", { limit: 50 });
    expect(result.current.draftThreadStates["thread-2"].messages.map((message) => message.id)).toEqual(["m-2", "u-3"]);
    expect(result.current.agentError).toBe("This question was already answered.");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/ask-user-wire.test.js tests/ask-user-dispatch.test.jsx`
Expected: FAIL. `answers` isn't in the request body, and `sendMessage` is called with 5 arguments.

- [ ] **Step 4: Add answers to sendMessage**

In `Voyage-Client/app/lib/api/agent.js`, replace:

```js
export async function sendMessage(agencyId, threadId, content, imageUrls = [], travelerNeeds = null) {
  return fetchApi(`/agencies/${agencyId}/agent/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      ...(travelerNeeds ? { travelerNeeds } : {}),
    }),
  });
}
```

with:

```js
export async function sendMessage(agencyId, threadId, content, imageUrls = [], travelerNeeds = null, answers = null) {
  return fetchApi(`/agencies/${agencyId}/agent/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      ...(travelerNeeds ? { travelerNeeds } : {}),
      // Answers to the agent's ask_user questions: { messageId, items }.
      ...(answers ? { answers } : {}),
    }),
  });
}
```

- [ ] **Step 5: Send answers from dispatchMessage**

In `Voyage-Client/app/hooks/useTripPlanning.js`, add this function directly above the `// Resolves to { sent, contextId, threadId }` comment that sits above `dispatchMessage`:

```js
  // Replace a context's messages with the server's copy, e.g. after an answer was
  // refused because its question had already been answered in another tab.
  const reloadThreadMessages = async (context, threadId) => {
    try {
      const result = await fetchThreadMessages(agencyId, threadId, { limit: 50 });
      // Server returns DESC (newest first); UI renders ASC.
      const ascending = [...(Array.isArray(result?.messages) ? result.messages : [])].reverse();
      const states = context.type === "draft" ? draftThreadStatesRef.current : tripStatesRef.current;
      const messages = normalizeMessagesArray(ascending, states[context.id]?.itinerary?.id ?? null);
      const applyMessages = (prev) => ({
        ...prev,
        [context.id]: { ...(prev[context.id] || {}), messages },
      });
      if (context.type === "draft") setDraftThreadStates(applyMessages);
      else setTripStates(applyMessages);
    } catch (reloadError) {
      console.error("Failed to reload thread messages", reloadError);
    }
  };

```

Replace the signature and the opening lines:

```js
  const dispatchMessage = async (content, startStream, imageFiles = [], travelerNeeds = null) => {
    const outcome = { sent: false, contextId: null, threadId: null };
```

with:

```js
  // `answers` (from buildAnswer) marks the message as the reply to ask_user questions.
  const dispatchMessage = async (content, startStream, imageFiles = [], travelerNeeds = null, { answers = null } = {}) => {
    const outcome = { sent: false, contextId: null, threadId: null };
    let sendContext = null;
```

Replace:

```js
      outcome.contextId = currentContext.id;
      outcome.threadId = currentThreadId;
```

with:

```js
      outcome.contextId = currentContext.id;
      outcome.threadId = currentThreadId;
      sendContext = currentContext;
```

Replace:

```js
      const metadata = imageUrls.length > 0 ? { imageUrls } : undefined;
      const message = { id: `user-${Date.now()}`, role: "user", content: messageContent, metadata };
```

with:

```js
      const metadata = {
        ...(imageUrls.length > 0 ? { imageUrls } : {}),
        ...(answers ? { answers: answers.display } : {}),
      };
      const message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: messageContent,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };
```

Replace:

```js
      const sendResult = await sendMessage(agencyId, currentThreadId, messageContent, imageUrls, travelerNeeds);
```

with:

```js
      const sendResult = answers
        ? await sendMessage(agencyId, currentThreadId, messageContent, imageUrls, travelerNeeds, answers.request)
        : await sendMessage(agencyId, currentThreadId, messageContent, imageUrls, travelerNeeds);
```

Replace:

```js
    } catch (error) {
      console.error("Failed to send agent message", error);
      setAgentError(error?.message || "Unable to send your request to Voyage Agent.");
    } finally {
```

with:

```js
    } catch (error) {
      console.error("Failed to send agent message", error);
      setAgentError(error?.message || "Unable to send your request to Voyage Agent.");
      // The question closed elsewhere (another tab answered it): show the server's copy.
      if (answers && error?.code === "QUESTION_NOT_PENDING" && sendContext && outcome.threadId) {
        await reloadThreadMessages(sendContext, outcome.threadId);
      }
    } finally {
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/ask-user-wire.test.js tests/ask-user-dispatch.test.jsx tests/traveler-needs-wire.test.js tests/traveler-needs-plumbing.test.jsx`
Expected: PASS. The traveler-needs tests still see `sendMessage` called with exactly 5 arguments.

- [ ] **Step 7: Commit**

```bash
git add app/lib/api/agent.js app/hooks/useTripPlanning.js tests/ask-user-wire.test.js tests/ask-user-dispatch.test.jsx
git commit -m "feat(agent): send answers to ask_user questions"
```

---

## Task C5: The question panel

**Files:**
- Create: `Voyage-Client/app/components/trip-dashboard/command-center/AskUserPanel.jsx`
- Test: `Voyage-Client/tests/ask-user-panel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `Voyage-Client/tests/ask-user-panel.test.jsx`:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AskUserPanel from "../app/components/trip-dashboard/command-center/AskUserPanel.jsx";

const questions = [
  {
    id: "q1",
    header: "Transport",
    question: "How will the travelers get around?",
    multiSelect: false,
    options: [{ label: "Private car", description: "Most stops per day" }, { label: "Public transit" }],
  },
  {
    id: "q2",
    header: "Interests",
    question: "What should the days focus on?",
    multiSelect: true,
    options: [{ label: "Food" }, { label: "Museums" }, { label: "Nature" }],
  },
];

function renderPanel(props = {}) {
  const onSubmit = vi.fn();
  const onDismiss = vi.fn();
  render(<AskUserPanel questions={questions} onSubmit={onSubmit} onDismiss={onDismiss} {...props} />);
  return { onSubmit, onDismiss };
}

describe("AskUserPanel", () => {
  it("shows the first question as a radio group and focuses its first option", () => {
    renderPanel();

    expect(screen.getByRole("group", { name: "How will the travelers get around?" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Private car/ })).toHaveFocus();
    expect(screen.getByText("Most stops per day")).toBeInTheDocument();
  });

  it("asks for an answer before moving on", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Pick an option or type your own answer.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "How will the travelers get around?" })).toBeInTheDocument();
  });

  it("steps through the questions and sends every answer", () => {
    const { onSubmit } = renderPanel();

    fireEvent.click(screen.getByRole("radio", { name: /Public transit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Food" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Museums" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));

    expect(onSubmit).toHaveBeenCalledWith({
      q1: { selected: ["Public transit"], other: "" },
      q2: { selected: ["Food", "Museums"], other: "" },
    });
  });

  it("keeps an earlier answer when going back", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("radio", { name: /Public transit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("radio", { name: /Public transit/ })).toBeChecked();
  });

  it("replaces a single choice with typed text", () => {
    const { onSubmit } = renderPanel({ questions: [questions[0]] });

    fireEvent.click(screen.getByRole("radio", { name: /Private car/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Something else" }), { target: { value: "Hired driver" } });

    expect(screen.getByRole("radio", { name: /Private car/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    expect(onSubmit).toHaveBeenCalledWith({ q1: { selected: [], other: "Hired driver" } });
  });

  it("hands back to the normal composer", () => {
    const { onDismiss } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Type a normal reply instead" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("moves on with Enter on an option", () => {
    renderPanel();
    const transit = screen.getByRole("radio", { name: /Public transit/ });

    fireEvent.click(transit);
    fireEvent.keyDown(transit, { key: "Enter" });

    expect(screen.getByRole("group", { name: "What should the days focus on?" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/ask-user-panel.test.jsx`
Expected: FAIL. The module isn't found.

- [ ] **Step 3: Build the panel**

Create `Voyage-Client/app/components/trip-dashboard/command-center/AskUserPanel.jsx`:

```jsx
import { useEffect, useId, useRef, useState } from "react";
import { emptyDraft, isAnswered } from "../../../lib/agent/askUser.js";

// Same surface as ChatInput's composer shell: the chat box changes shape, not style.
const panelSurfaceClass =
  "w-full min-w-0 rounded-[18px] border border-border bg-[rgba(255,255,255,0.88)] px-4 py-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)] dark:bg-[rgba(26,29,33,0.88)]";

/**
 * The composer while the agent waits on ask_user questions: one question at a time,
 * radio rows (checkboxes for multi-select), a free-text "Something else", and a way
 * back to the normal text box. Calls onSubmit(draft) once every question is answered.
 */
export default function AskUserPanel({ questions, onSubmit, onDismiss, error = "", containerClassName = "" }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => emptyDraft(questions));
  const [showError, setShowError] = useState(false);
  const firstOptionRef = useRef(null);
  const baseId = useId();

  const question = questions[step];
  const entry = draft[question.id];
  const isLast = step === questions.length - 1;
  const errorId = `${baseId}-error`;

  // The text box this panel replaced had focus; move it to the options.
  useEffect(() => {
    firstOptionRef.current?.focus();
  }, [step]);

  function update(patch) {
    setDraft((previous) => ({ ...previous, [question.id]: { ...previous[question.id], ...patch } }));
    setShowError(false);
  }

  function toggleOption(label) {
    if (!question.multiSelect) {
      update({ selected: [label], other: "" });
      return;
    }
    update({
      selected: entry.selected.includes(label)
        ? entry.selected.filter((value) => value !== label)
        : [...entry.selected, label],
    });
  }

  function changeOther(value) {
    // A typed answer replaces a single choice; with multi-select it adds to the picks.
    update(question.multiSelect ? { other: value } : { other: value, selected: [] });
  }

  function goBack() {
    setStep((current) => current - 1);
    setShowError(false);
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!isAnswered(entry)) {
      setShowError(true);
      return;
    }
    if (isLast) {
      onSubmit(draft);
      return;
    }
    setStep((current) => current + 1);
  }

  function handleKeyDown(event) {
    // Browsers only submit on Enter from the text field; options should move on too.
    if (event.key === "Enter" && (event.target.type === "radio" || event.target.type === "checkbox")) {
      handleSubmit(event);
    }
  }

  return (
    <div className={`mt-auto pt-3 w-full ${containerClassName}`}>
      <p className="sr-only" aria-live="polite">
        {questions.length === 1 ? "Voyage asked you a question." : `Voyage asked you ${questions.length} questions.`}
      </p>
      <form className={panelSurfaceClass} onSubmit={handleSubmit} onKeyDown={handleKeyDown} aria-label="Questions from Voyage">
        <div className="mb-2.5 flex items-center gap-2">
          <div className="flex flex-wrap gap-1.5" aria-hidden="true">
            {questions.map((item, index) => (
              <span
                key={item.id}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${
                  index === step ? "border-secondary bg-secondary/10 text-text-primary" : "border-border/20 text-text-muted"
                }`}
              >
                {item.header}
              </span>
            ))}
          </div>
          {questions.length > 1 && (
            <span className="ml-auto flex-shrink-0 text-[12px] text-text-muted">
              {step + 1} of {questions.length}
            </span>
          )}
        </div>
        <fieldset className="m-0 min-w-0 border-0 p-0" aria-describedby={showError ? errorId : undefined}>
          <legend className="mb-2.5 p-0 text-[15px] font-semibold leading-snug text-text-primary">{question.question}</legend>
          <div className="grid max-h-[45vh] gap-1.5 overflow-y-auto">
            {question.options.map((option, index) => {
              const checked = entry.selected.includes(option.label);
              return (
                <label
                  key={option.label}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-[12px] border px-3 py-2.5 transition-colors ${
                    checked
                      ? "border-secondary bg-secondary/10"
                      : "border-border/15 [@media(hover:hover)_and_(pointer:fine)]:hover:border-border/35"
                  }`}
                >
                  <input
                    ref={index === 0 ? firstOptionRef : undefined}
                    type={question.multiSelect ? "checkbox" : "radio"}
                    name={`${baseId}-${question.id}`}
                    value={option.label}
                    checked={checked}
                    onChange={() => toggleOption(option.label)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-secondary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-primary">{option.label}</span>
                    {option.description && (
                      <span className="block text-[13px] leading-snug text-text-muted">{option.description}</span>
                    )}
                  </span>
                </label>
              );
            })}
            <label className="flex items-center gap-2.5 rounded-[12px] border border-dashed border-border/30 px-3 py-1">
              <span className="sr-only">Something else</span>
              <input
                type="text"
                value={entry.other}
                onChange={(event) => changeOther(event.target.value)}
                placeholder="Something else? Type it here"
                maxLength={500}
                className="h-10 min-w-0 flex-1 border-0 bg-transparent text-[16px] text-text-primary outline-none placeholder:text-text-soft"
              />
            </label>
          </div>
        </fieldset>
        {showError ? (
          <p id={errorId} className="mt-2 text-xs text-status-danger">
            Pick an option or type your own answer.
          </p>
        ) : error ? (
          <p className="mt-2 text-xs text-status-danger">{error}</p>
        ) : null}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer border-0 bg-transparent px-1 text-[13px] font-medium text-text-muted underline-offset-2 hover:underline"
          >
            Type a normal reply instead
          </button>
          {step > 0 && (
            <button
              type="button"
              onClick={goBack}
              className="ml-auto h-10 cursor-pointer rounded-md border border-border/20 bg-transparent px-4 text-sm font-semibold text-text-primary"
            >
              Back
            </button>
          )}
          <button
            type="submit"
            className={`${step > 0 ? "" : "ml-auto "}h-10 cursor-pointer rounded-md border-0 bg-secondary-strong px-4 text-sm font-semibold text-on-secondary-strong transition-opacity hover:opacity-90`}
          >
            {isLast ? "Send answers" : "Next"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/ask-user-panel.test.jsx tests/theme-safe-classes.test.js tests/no-mojibake.test.js tests/heading-typography.test.js`
Expected: PASS. The last three are lint-style suites, and the new component must not trip them.

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/command-center/AskUserPanel.jsx tests/ask-user-panel.test.jsx
git commit -m "feat(agent): add the ask_user question panel"
```

---

## Task C6: The composer switch

**Files:**
- Create: `Voyage-Client/app/components/trip-dashboard/command-center/ChatComposer.jsx`
- Test: `Voyage-Client/tests/chat-composer.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `Voyage-Client/tests/chat-composer.test.jsx`:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import ChatComposer from "../app/components/trip-dashboard/command-center/ChatComposer.jsx";

const questions = [
  { id: "q1", header: "Transport", question: "Car or train?", multiSelect: false, options: [{ label: "Car" }, { label: "Train" }] },
];
const asking = { id: "m-2", role: "assistant", content: "One question first.", metadata: { askUser: { questions } } };

function composerProps(overrides = {}) {
  return {
    messages: [asking],
    onAnswer: vi.fn(),
    textareaRef: createRef(),
    composerInput: "",
    setComposerInput: vi.fn(),
    handleKeyDown: vi.fn(),
    submitComposer: vi.fn(),
    isSending: false,
    agentError: "",
    ...overrides,
  };
}

describe("ChatComposer", () => {
  it("shows the question panel while the newest reply is asking", () => {
    render(<ChatComposer {...composerProps()} />);

    expect(screen.getByRole("group", { name: "Car or train?" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Ask the agent to adjust the draft...")).not.toBeInTheDocument();
  });

  it("shows the normal composer when nothing is asked", () => {
    render(<ChatComposer {...composerProps({ messages: [{ id: "m-1", role: "assistant", content: "Done." }] })} />);

    expect(screen.getByPlaceholderText("Ask the agent to adjust the draft...")).toBeInTheDocument();
  });

  it("keeps the normal composer while a message is sending", () => {
    render(<ChatComposer {...composerProps({ isSending: true })} />);

    expect(screen.queryByRole("group", { name: "Car or train?" })).not.toBeInTheDocument();
  });

  it("sends the answer text and payload", () => {
    const props = composerProps();
    render(<ChatComposer {...props} />);

    fireEvent.click(screen.getByRole("radio", { name: "Train" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));

    expect(props.onAnswer).toHaveBeenCalledWith(
      "Transport: Train",
      expect.objectContaining({ request: { messageId: "m-2", items: [{ questionId: "q1", selected: ["Train"] }] } }),
    );
  });

  it("returns to the text box when dismissed, and asks again for a newer question", () => {
    const props = composerProps();
    const { rerender } = render(<ChatComposer {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Type a normal reply instead" }));
    expect(screen.getByPlaceholderText("Ask the agent to adjust the draft...")).toBeInTheDocument();

    rerender(
      <ChatComposer {...props} messages={[asking, { id: "u-3", role: "user", content: "Hm" }, { ...asking, id: "m-4" }]} />,
    );
    expect(screen.getByRole("group", { name: "Car or train?" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/chat-composer.test.jsx`
Expected: FAIL. The module isn't found.

- [ ] **Step 3: Build the switch**

Create `Voyage-Client/app/components/trip-dashboard/command-center/ChatComposer.jsx`:

```jsx
import { useEffect, useMemo, useState } from "react";
import ChatInput from "./ChatInput.jsx";
import AskUserPanel from "./AskUserPanel.jsx";
import { buildAnswer, findPendingQuestion } from "../../../lib/agent/askUser.js";

/**
 * The chat composer: the agent's open ask_user question as a picker, otherwise the
 * normal text box. Both composer mounts (desktop panel, mobile sheet) use it.
 * `onAnswer(text, answer)` sends the answer; every other prop goes to ChatInput.
 */
export default function ChatComposer({ messages, onAnswer, ...inputProps }) {
  const pending = useMemo(() => findPendingQuestion(messages), [messages]);
  // The question the user set aside to type a normal reply instead.
  const [dismissedId, setDismissedId] = useState(null);
  const { textareaRef, isSending, agentError, containerClassName } = inputProps;

  useEffect(() => {
    if (dismissedId) textareaRef?.current?.focus();
  }, [dismissedId, textareaRef]);

  if (pending && pending.messageId !== dismissedId && !isSending) {
    return (
      <AskUserPanel
        key={pending.messageId}
        questions={pending.questions}
        error={agentError}
        containerClassName={containerClassName}
        onDismiss={() => setDismissedId(pending.messageId)}
        onSubmit={(draft) => {
          const answer = buildAnswer(pending, draft);
          onAnswer?.(answer.text, answer);
        }}
      />
    );
  }

  return <ChatInput {...inputProps} />;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/chat-composer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/command-center/ChatComposer.jsx tests/chat-composer.test.jsx
git commit -m "feat(agent): switch the composer to the question panel"
```

---

## Task C7: Wire both composers and the chat history

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/command-center/ChatMessage.jsx`, `AgentCommandCenter.jsx`, `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`
- Test: `Voyage-Client/tests/ask-user-history.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `Voyage-Client/tests/ask-user-history.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgentCommandCenter from "../app/components/trip-dashboard/command-center/AgentCommandCenter.jsx";
import ChatMessage from "../app/components/trip-dashboard/command-center/ChatMessage.jsx";

const questions = [
  { id: "q1", header: "Transport", question: "How will the travelers get around?", multiSelect: false, options: [{ label: "Private car" }, { label: "Public transit" }] },
  { id: "q2", header: "Trip length", question: "How many days should I plan?", multiSelect: false, options: [{ label: "2 days" }, { label: "3 days" }] },
];
const asking = { id: "m-2", role: "assistant", content: "A couple of details first.", metadata: { askUser: { questions } } };
const answer = {
  id: "u-3",
  role: "user",
  content: "Transport: Public transit\nTrip length: 4 days",
  metadata: {
    answers: {
      messageId: "m-2",
      items: [
        { questionId: "q1", header: "Transport", question: questions[0].question, selected: ["Public transit"] },
        { questionId: "q2", header: "Trip length", question: questions[1].question, selected: [], other: "4 days" },
      ],
    },
  },
};

function renderCenter(messages) {
  return render(
    <AgentCommandCenter
      messages={messages}
      isStreaming={false}
      assistantMessage=""
      toolCalls={[]}
      thoughtEntries={[]}
      dispatchAgentMessage={vi.fn()}
      dispatchAgentAnswer={vi.fn()}
      composerInput=""
      setComposerInput={vi.fn()}
      isSending={false}
      agentError=""
      user={{ displayName: "Jerald" }}
    />,
  );
}

describe("ask_user in the chat history", () => {
  it("shows each answer next to its question's header", () => {
    render(<ChatMessage message={answer} isUser userName="Jerald" userInitials="JD" />);

    expect(screen.getByText("Transport")).toBeInTheDocument();
    expect(screen.getByText("Public transit")).toBeInTheDocument();
    expect(screen.getByText("4 days")).toBeInTheDocument();
    expect(screen.queryByText(/Transport: Public transit/)).not.toBeInTheDocument();
  });

  it("lists the questions a skipped reply asked", () => {
    render(<ChatMessage message={asking} isUser={false} userName="Jerald" userInitials="JD" askUserStatus="skipped" />);

    expect(screen.getByText("Not answered: Transport, Trip length")).toBeInTheDocument();
  });

  it("shows the question panel in place of the composer while a question is open", () => {
    renderCenter([{ id: "u-1", role: "user", content: "Plan Kyoto" }, asking]);

    expect(screen.getByRole("group", { name: "How will the travelers get around?" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Ask the agent to adjust the draft...")).not.toBeInTheDocument();
  });

  it("offers no edit button on an answer", () => {
    renderCenter([asking, answer]);

    expect(screen.queryByRole("button", { name: "Edit this message" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/ask-user-history.test.jsx`
Expected: FAIL. The answer bubble shows the raw text, and there's no panel.

- [ ] **Step 3: Render answers and skipped questions in ChatMessage**

In `Voyage-Client/app/components/trip-dashboard/command-center/ChatMessage.jsx`, below the `ProcessBubble` import, add:

```jsx
import { answerText, getAnswers, getAskUser } from "../../../lib/agent/askUser.js";
```

Add this component above `export default function ChatMessage`:

```jsx
// An answer to the agent's ask_user questions: each header beside its answer.
function AnswerPairs({ answers }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3.5 gap-y-1">
      {answers.items.map((item) => (
        <React.Fragment key={item.questionId}>
          <dt className="text-xs font-medium text-text-muted">{item.header}</dt>
          <dd className="m-0 font-medium">{answerText(item)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
```

Replace the start of the component:

```jsx
  process = null,
  onProcessToggle,
}) {
  const shouldRenderRichItinerary = !isUser && renderAsItinerary && itinerary;
```

with:

```jsx
  process = null,
  onProcessToggle,
  // "pending" | "answered" | "skipped" when this reply asked ask_user questions.
  askUserStatus = null,
}) {
  const shouldRenderRichItinerary = !isUser && renderAsItinerary && itinerary;
  const answers = isUser ? getAnswers(message) : null;
  const askedQuestions = isUser ? null : getAskUser(message);
```

Replace the user branch:

```jsx
          {isUser ? (
            <div>
              <p className="m-0 font-medium">{message.content}</p>
              {message.metadata?.imageUrls?.length > 0 && (
                <MessageImageGrid imageUrls={message.metadata.imageUrls} />
              )}
            </div>
          ) : renderAsItinerary && itinerary ? (
```

with:

```jsx
          {isUser ? (
            answers ? (
              <AnswerPairs answers={answers} />
            ) : (
              <div>
                <p className="m-0 font-medium">{message.content}</p>
                {message.metadata?.imageUrls?.length > 0 && (
                  <MessageImageGrid imageUrls={message.metadata.imageUrls} />
                )}
              </div>
            )
          ) : renderAsItinerary && itinerary ? (
```

Replace the end of the component:

```jsx
              showPlaceCards={false}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

with:

```jsx
              showPlaceCards={false}
            />
          )}
          {askUserStatus === "skipped" && askedQuestions && (
            <p className="m-0 mt-2.5 border-t border-dashed border-border/30 pt-2 text-xs text-text-muted">
              Not answered: {askedQuestions.map((question) => question.header).join(", ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Use ChatComposer in AgentCommandCenter**

In `Voyage-Client/app/components/trip-dashboard/command-center/AgentCommandCenter.jsx`, replace:

```jsx
import ChatInput from "./ChatInput.jsx";
```

with:

```jsx
import ChatComposer from "./ChatComposer.jsx";
import { askUserStatuses, getAnswers } from "../../../lib/agent/askUser.js";
```

Replace:

```jsx
  dispatchAgentMessage,
  composerInput,
```

with:

```jsx
  dispatchAgentMessage,
  // (text, answer) => sends answers to the agent's ask_user questions.
  dispatchAgentAnswer = null,
  composerInput,
```

Replace:

```jsx
  const liveStreamingItinerary = streamingItinerary ?? null;
```

with:

```jsx
  const liveStreamingItinerary = streamingItinerary ?? null;
  const askStatuses = useMemo(() => askUserStatuses(messages), [messages]);
```

In the `displayedMessages.map(...)` `<ChatMessage>`, replace:

```jsx
              onEdit={message.role === "user" ? (content) => setComposerInput(content) : undefined}
              process={message.process ?? null}
              onProcessToggle={message.process ? (isOpen) => handleProcessToggle(message.id, isOpen) : undefined}
            />
```

with:

```jsx
              onEdit={message.role === "user" && !getAnswers(message) ? (content) => setComposerInput(content) : undefined}
              process={message.process ?? null}
              onProcessToggle={message.process ? (isOpen) => handleProcessToggle(message.id, isOpen) : undefined}
              askUserStatus={askStatuses.get(message.id) ?? null}
            />
```

Replace:

```jsx
            <ChatInput
          textareaRef={textareaRef}
```

with:

```jsx
            <ChatComposer
          messages={messages}
          onAnswer={dispatchAgentAnswer}
          textareaRef={textareaRef}
```

- [ ] **Step 5: Wire HomePage**

In `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`, replace:

```jsx
import ChatInput from "./command-center/ChatInput.jsx";
```

with:

```jsx
import ChatComposer from "./command-center/ChatComposer.jsx";
```

Replace:

```jsx
  function handleMobileSubmit(event) {
    event.preventDefault();
    if (!composerInput.trim()) return;
    void sendWithNeeds((needs) => dispatchMessage(composerInput, startStream, [], needs));
    setComposerInput("");
  }
```

with:

```jsx
  function handleMobileSubmit(event) {
    event.preventDefault();
    if (!composerInput.trim()) return;
    void sendWithNeeds((needs) => dispatchMessage(composerInput, startStream, [], needs));
    setComposerInput("");
  }

  // Answers to the agent's ask_user questions go out as a normal message with the
  // structured answers attached; traveler needs ride along as for typed messages.
  function answerAgentQuestion(text, answer) {
    void sendWithNeeds((needs) => dispatchMessage(text, startStream, [], needs, { answers: answer }));
  }
```

In the desktop `<AgentCommandCenter>`, replace:

```jsx
                    travelerNeeds={activeTravelerNeeds}
                    onEditTravelerNeeds={() => setIsTravelerNeedsOpen(true)}
                    needsToggleRef={desktopNeedsToggleRef}
                  />
```

with:

```jsx
                    travelerNeeds={activeTravelerNeeds}
                    onEditTravelerNeeds={() => setIsTravelerNeedsOpen(true)}
                    needsToggleRef={desktopNeedsToggleRef}
                    dispatchAgentAnswer={answerAgentQuestion}
                  />
```

In the mobile sheet footer, replace:

```jsx
                  footer={
                    <ChatInput
                      textareaRef={mobileTextareaRef}
```

with:

```jsx
                  footer={
                    <ChatComposer
                      messages={effectiveTripState?.messages ?? []}
                      onAnswer={answerAgentQuestion}
                      textareaRef={mobileTextareaRef}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/ask-user-history.test.jsx tests/agent-command-center-places.test.jsx tests/home-page.test.jsx tests/home-page-traveler-needs.test.jsx tests/reuseSlashCommand.behaviour.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/trip-dashboard/command-center/ChatMessage.jsx app/components/trip-dashboard/command-center/AgentCommandCenter.jsx app/components/trip-dashboard/HomePage.jsx tests/ask-user-history.test.jsx
git commit -m "feat(agent): show the question panel in both composers and pair answers in history"
```

---

## Task C8: Process bubble labels

**Files:**
- Modify: `Voyage-Client/app/components/agent/process-bubble/processBubbleLabels.js`
- Test: `Voyage-Client/tests/process-bubble-labels.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/process-bubble-labels.test.js`:

```js
describe("ask_user labels", () => {
  it('shows "Preparing a question…" while ask_user runs', () => {
    expect(toolToActiveLabel("ask_user")).toBe("Preparing a question…");
  });

  it("summarizes a run that asked as asking for input", () => {
    const timeline = [
      { id: "tool-1", kind: "tool", name: "add_itinerary_item" },
      { id: "tool-2", kind: "tool", name: "ask_user" },
    ];

    expect(summarize(timeline, 1400)).toBe("Asked for your input · 1.4s");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/process-bubble-labels.test.js`
Expected: FAIL. The current output is "Ask User…" and "Worked for 1.4s".

- [ ] **Step 3: Add the labels**

In `Voyage-Client/app/components/agent/process-bubble/processBubbleLabels.js`, replace:

```js
  weather_forecast: "Checking the weather…",
};
```

with:

```js
  weather_forecast: "Checking the weather…",
  ask_user: "Preparing a question…",
};
```

In `summarize`, replace:

```js
  if (toolEntries.length === 0) {
    return `Thought for ${durationStr}`;
  }

  const hasMapPinpoint = toolEntries.some((entry) => entry.name === "map_pinpoint");
```

with:

```js
  if (toolEntries.length === 0) {
    return `Thought for ${durationStr}`;
  }

  // Matches the server's summary for a run that ended by asking the user.
  if (toolEntries.some((entry) => entry.name === "ask_user")) {
    return `Asked for your input · ${durationStr}`;
  }

  const hasMapPinpoint = toolEntries.some((entry) => entry.name === "map_pinpoint");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/process-bubble-labels.test.js tests/process-bubble.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/agent/process-bubble/processBubbleLabels.js tests/process-bubble-labels.test.js
git commit -m "feat(agent): label runs that ask the user"
```

---

## Task F: End-to-end verification

**Files:** none, unless QA finds a bug.

- [ ] **Step 1: Run both full suites and both builds**

- Server (`Voyage-Server`): `npm test 2>&1 | tail -20`, then `npm run build`.
- Client (`Voyage-Client`): `npm test 2>&1 | tail -20`, then `npm run build`.

Expected: both builds succeed. No test file fails that wasn't already failing in Task 0.

- [ ] **Step 2: Restart the backend, then QA in the browser**

Restart the backend first; OneDrive means the watcher may have missed edits. Use the in-app browser on desktop width, then the mobile preset (375×812), in light and dark themes. Check each scenario:

1. **First question.** In a new draft, send "Plan a trip to Kyoto".
   - Expected: the run ends quickly with a lead-in sentence, and the composer turns into the panel with a Transport question, possibly bundled with Trip length.
   - The process bubble reads "Asked for your input · Xs".
2. **Answering.** Pick options, use Back/Next, then press "Send answers".
   - Expected: the answer bubble shows header/answer pairs, and a new run starts and drafts the itinerary without asking the same thing again.
3. **"Something else".** Type a custom answer, for example "4 days". The agent should use it.
4. **Skip.** Press "Type a normal reply instead".
   - Expected: the text box returns with focus, and the earlier typed text is still in it.
   - Send a normal message: the agent's earlier reply shows "Not answered: …".
5. **Reload with an open question.** The panel comes back. User message images also survive the reload (the normalizer fix).
6. **Two tabs.** Answer in tab A, then try in tab B.
   - Expected: tab B shows "This question was already answered." and reloads to tab A's answer.
7. **Mid-build question.** Plan three dated days where the forecast has rain, or say "ask me before swapping any outdoor stop".
   - Expected: stops added before the question stay. After the answer, the next run continues filling the draft.
8. **Mobile.** At 375 px the panel fits the sheet footer. Options scroll inside the panel when needed. The page doesn't scroll sideways.
9. **Keyboard.** Arrow keys move between radios, Space toggles checkboxes, Enter goes to Next, and focus starts on the first option.

- [ ] **Step 3: Note how well the model follows the tool**

Over 10 or more prompts, count how often Gemini still writes markdown bullet questions instead of calling `ask_user`. That's harmless, because the composer stays a text box. If it happens in more than about 2 of 10, tighten the prompt wording in Task S6 as a follow-up.

- [ ] **Step 4: Commit any QA fixes**

Commit each fix in its repo with `fix(agent): ...`. Do not push.

---

## Out of scope (follow-ups)

- Yes/No confirmations before destructive changes, such as deleting a day or rebuilding the trip. The user left these out.
- Keeping the run paused in memory while waiting for an answer (approach 2 or 3).
- Number-key shortcuts in the panel, and question counts in the process summary label.
- Parsing markdown questions the model writes despite the prompt.
- Personal (no-agency) accounts. They have no agent message route today (see the personal-account memory).
