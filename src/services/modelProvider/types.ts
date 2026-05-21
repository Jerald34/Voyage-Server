export type ModelMessagePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  parts?: ModelMessagePart[];
};

export type ModelUsage = {
  model: string;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  toolUsePromptTokenCount?: number;
  thoughtsTokenCount?: number;
  trafficType?: string;
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  cacheTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  estimatedCostUsd?: {
    prompt: number;
    output: number;
    total: number;
  };
};

export type ModelCompletionInput = {
  messages: ModelMessage[];
  temperature?: number;
};

export type ModelStreamInput = ModelCompletionInput & {
  onUsage?: (usage: ModelUsage) => void;
};

export type ModelProvider = {
  complete(input: ModelCompletionInput): Promise<{ content: string; usage?: ModelUsage }>;
  completeStream?(input: ModelStreamInput): AsyncIterable<string>;
};
