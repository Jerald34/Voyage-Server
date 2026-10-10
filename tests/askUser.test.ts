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
import { createAgentToolRegistry, createAskUserTool } from "../src/modules/agent/agentTools";
import { createMessageSchema } from "../src/modules/agent/agentSchemas";

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
