import { env } from "../../config/env";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createLmStudioModelProvider, createOpenRouterModelProvider } from "./openaiCompatible";
import { createGoogleVertexModelProvider, createGoogleModelProvider } from "./vertex";
import type { ModelProvider } from "./types";

const DEFAULT_GOOGLE_AI_MODEL = "gemini-3-flash-preview";

export type ModelProviderInfo = {
  provider: "vertex" | "openrouter" | "google_ai" | "lm_studio";
  model: string;
};

function hasLocalAdcCredentials() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    join(process.env.APPDATA ?? "", "gcloud", "application_default_credentials.json"),
    join(process.env.USERPROFILE ?? "", ".config", "gcloud", "application_default_credentials.json")
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return candidates.some((filePath) => existsSync(filePath));
}

function resolveModelProviderSelection() {
  const selected = env.MODEL_PROVIDER;

  if (selected === "vertex") {
    return {
      provider: "vertex" as const,
      model: env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL,
      create: () => createGoogleVertexModelProvider()
    };
  }

  if (selected === "openrouter") {
    return {
      provider: "openrouter" as const,
      model: env.OPENROUTER_MODEL,
      create: () => openRouterModelProvider
    };
  }

  if (selected === "google_ai" || selected === "gemini") {
    return {
      provider: "google_ai" as const,
      model: env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL,
      create: () => googleModelProvider
    };
  }

  if (selected === "lm_studio") {
    return {
      provider: "lm_studio" as const,
      model: env.LM_STUDIO_MODEL,
      create: () => lmStudioModelProvider
    };
  }

  if (env.GOOGLE_CLOUD_API_KEY || env.GOOGLE_SA_CREDENTIALS || hasLocalAdcCredentials()) {
    return {
      provider: "vertex" as const,
      model: env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL,
      create: () => createGoogleVertexModelProvider()
    };
  }

  if (env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter" as const,
      model: env.OPENROUTER_MODEL,
      create: () => openRouterModelProvider
    };
  }

  if (env.GOOGLE_AI_API_KEY) {
    return {
      provider: "google_ai" as const,
      model: env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL,
      create: () => googleModelProvider
    };
  }

  return {
    provider: "lm_studio" as const,
    model: env.LM_STUDIO_MODEL,
    create: () => lmStudioModelProvider
  };
}

export const lmStudioModelProvider = createLmStudioModelProvider();
export const googleModelProvider = createGoogleModelProvider();
export const openRouterModelProvider = createOpenRouterModelProvider();

export function getModelProviderInfo(): ModelProviderInfo {
  const selection = resolveModelProviderSelection();
  return {
    provider: selection.provider,
    model: selection.model
  };
}

export function getModelProvider(): ModelProvider {
  return resolveModelProviderSelection().create();
}
