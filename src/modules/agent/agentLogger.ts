
import type { ModelUsage } from "../../services/modelProvider";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function formatTimestamp() {
  return new Date().toISOString();
}

function formatMoney(value: number) {
  return `$${value.toFixed(6)}`;
}

function formatModelUsage(usage: ModelUsage) {
  return JSON.stringify(
    {
      model: usage.model,
      promptTokenCount: usage.promptTokenCount ?? null,
      candidatesTokenCount: usage.candidatesTokenCount ?? null,
      totalTokenCount: usage.totalTokenCount ?? null,
      cachedContentTokenCount: usage.cachedContentTokenCount ?? null,
      toolUsePromptTokenCount: usage.toolUsePromptTokenCount ?? null,
      thoughtsTokenCount: usage.thoughtsTokenCount ?? null,
      trafficType: usage.trafficType ?? null,
      promptTokensDetails: usage.promptTokensDetails ?? null,
      cacheTokensDetails: usage.cacheTokensDetails ?? null,
      candidatesTokensDetails: usage.candidatesTokensDetails ?? null,
      estimatedCostUsd: usage.estimatedCostUsd
        ? {
            prompt: formatMoney(usage.estimatedCostUsd.prompt),
            output: formatMoney(usage.estimatedCostUsd.output),
            total: formatMoney(usage.estimatedCostUsd.total)
          }
        : null
    },
    null,
    2
  );
}

export const agentLogger = {
  toolStart: (name: string, input: unknown) => {
    console.log(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.cyan}🛠️  [Tool Start]${COLORS.reset} ${COLORS.magenta}${name}${COLORS.reset}\n${COLORS.dim}Input:${COLORS.reset}`,
      JSON.stringify(input, null, 2)
    );
  },
  toolSuccess: (id: string, name: string, output: unknown) => {
    console.log(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.green}✅ [Tool Success]${COLORS.reset} ${COLORS.magenta}${name}${COLORS.reset} ${COLORS.dim}(ID: ${id})${COLORS.reset}\n${COLORS.dim}Output Summary:${COLORS.reset} ${output}`
    );
  },
  toolFail: (id: string, name: string, code: string, message: string) => {
    console.error(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.red}❌ [Tool Failed]${COLORS.reset} ${COLORS.magenta}${name}${COLORS.reset} ${COLORS.dim}(ID: ${id})${COLORS.reset}\n${COLORS.red}Code:${COLORS.reset} ${code} - ${COLORS.red}Message:${COLORS.reset} ${message}`
    );
  },
  modelOutput: (runId: string, content: string, usage?: ModelUsage) => {
    console.log(
      `\n${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.yellow}🤖 [Model Output]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset}\n${COLORS.yellow}--- CONTENT START ---${COLORS.reset}\n${content}\n${COLORS.yellow}--- CONTENT END ---${COLORS.reset}${usage ? `\n${COLORS.cyan}--- USAGE START ---${COLORS.reset}\n${formatModelUsage(usage)}\n${COLORS.cyan}--- USAGE END ---${COLORS.reset}` : ""}`
    );
  },
  synthesisOutput: (runId: string, content: string, usage?: ModelUsage) => {
    console.log(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.blue}✍️  [Synthesis]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset}\n${content}${usage ? `\n${COLORS.cyan}${formatModelUsage(usage)}${COLORS.reset}` : ""}\n`
    );
  },
  agentResponse: (runId: string, content: string) => {
    console.log(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.green}💬 [Agent Response]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset}\n${COLORS.green}Final Content:${COLORS.reset} ${content}\n`
    );
  },
  error: (context: string, runId: string, error: any) => {
    console.error(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.red}🚨 [Error: ${context}]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset}\n`,
      error
    );
  },
  debug: (runId: string, message: string) => {
    console.log(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.magenta}🔍 [Debug]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset} ${message}`
    );
  }
};
