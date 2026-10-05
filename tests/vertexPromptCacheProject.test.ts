import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// With no project configured anywhere, Google's own lookup throws.
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getProjectId(): Promise<string> {
      throw new Error("Unable to detect a Project Id in the current environment.");
    }
    async getAccessToken(): Promise<null> {
      return null;
    }
  }
}));

import { createGoogleVertexModelProvider } from "../src/services/modelProvider/vertex";

// The agent's system prompt is far over the 3000 characters that turn on prompt caching.
const longSystemPrompt = "Voyage system instructions that are long enough to be cached. ".repeat(80);
const expressUrl =
  "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-3-flash-preview:generateContent?key=test-cloud-key";

describe("Vertex API-key mode without a Cloud project", () => {
  const saved = {
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    appData: process.env.APPDATA,
    userProfile: process.env.USERPROFILE
  };

  // No local ADC files, so the provider stays in API-key mode on any machine.
  beforeAll(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "C:/does-not-exist";
    process.env.APPDATA = "";
    process.env.USERPROFILE = "";
  });

  afterAll(() => {
    for (const [key, value] of [
      ["GOOGLE_APPLICATION_CREDENTIALS", saved.credentials],
      ["APPDATA", saved.appData],
      ["USERPROFILE", saved.userProfile]
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // Prompt caching needs a project; without one it is skipped, and the answer still comes.
  it("answers without the prompt cache instead of failing the request", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Here you go." }] } }] }), {
        status: 200
      });
    };
    const provider = createGoogleVertexModelProvider({
      apiKey: "test-cloud-key",
      projectId: "",
      model: "gemini-3-flash-preview",
      fetchImpl
    });

    const result = await provider.complete({
      messages: [
        { role: "system", content: longSystemPrompt },
        { role: "user", content: "Build a Cebu itinerary." }
      ]
    });

    expect(result.content).toBe("Here you go.");
    expect(calls).toEqual([expressUrl]);
  });

  it("streams without the prompt cache instead of failing the request", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\ndata: [DONE]\n\n', {
        status: 200
      });
    };
    const provider = createGoogleVertexModelProvider({
      apiKey: "test-cloud-key",
      projectId: "",
      model: "gemini-3-flash-preview",
      fetchImpl
    });

    const chunks: unknown[] = [];
    for await (const chunk of provider.completeStream!({
      messages: [
        { role: "system", content: longSystemPrompt },
        { role: "user", content: "Stream this." }
      ]
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ kind: "text", value: "Hi" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(":streamGenerateContent");
  });
});
