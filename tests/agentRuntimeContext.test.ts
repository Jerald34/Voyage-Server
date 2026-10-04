import { describe, expect, it } from "vitest";
import {
  attachImagePartsToLastUser,
  buildRunDateBlock,
  injectRuntimeContextIntoLastUser
} from "../src/modules/agent/agentContextBuilder";

describe("buildRunDateBlock", () => {
  it("states the UTC date", () => {
    expect(buildRunDateBlock(new Date("2026-10-01T23:30:00.000Z"))).toBe(
      'Today\'s date (UTC): 2026-10-01. Resolve relative or year-less dates (for example "next Friday" or "Dec 5") against it.'
    );
  });
});

describe("attachImagePartsToLastUser", () => {
  const image = { inlineData: { mimeType: "image/png", data: "AQID" } };

  it("builds the text part from the message's current, context-injected content", () => {
    const withContext = injectRuntimeContextIntoLastUser(
      [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: "What is this place?" }
      ],
      "RUNTIME CONTEXT"
    );

    const result = attachImagePartsToLastUser(withContext, [image]);

    expect(result[0]).toEqual({ role: "user", content: "Earlier question" });
    expect(result[2].parts).toEqual([{ text: "RUNTIME CONTEXT\n\n---\n\nWhat is this place?" }, image]);
  });

  it("returns the same array when there are no images", () => {
    const messages = [{ role: "user" as const, content: "Hi" }];

    expect(attachImagePartsToLastUser(messages, [])).toBe(messages);
  });
});
