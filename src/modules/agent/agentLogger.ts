
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

const MESSAGE_PREVIEW_CHARS = 250;

function truncateMessage(content: string) {
  if (!content) {
    return "(empty)";
  }
  const trimmed = content.trim();
  if (trimmed.length <= MESSAGE_PREVIEW_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MESSAGE_PREVIEW_CHARS)}… [+${trimmed.length - MESSAGE_PREVIEW_CHARS} chars]`;
}

function formatCacheStatus(usage: ModelUsage) {
  const cached = usage.cachedContentTokenCount ?? 0;
  const prompt = usage.promptTokenCount ?? 0;

  if (cached > 0 && prompt > 0) {
    const ratio = Math.round((cached / prompt) * 100);
    return `${COLORS.green}💾 Cache HIT${COLORS.reset} ${cached}/${prompt} prompt tokens cached (${ratio}%)`;
  }
  if (prompt > 0) {
    return `${COLORS.yellow}💾 Cache MISS${COLORS.reset} 0/${prompt} prompt tokens cached`;
  }
  return `${COLORS.dim}💾 Cache n/a${COLORS.reset}`;
}

function formatModelUsage(usage: ModelUsage) {
  const cacheStatus = formatCacheStatus(usage);
  const cost = usage.estimatedCostUsd
    ? `cost ${formatMoney(usage.estimatedCostUsd.total)} (in ${formatMoney(usage.estimatedCostUsd.prompt)}, out ${formatMoney(usage.estimatedCostUsd.output)})`
    : "cost n/a";
  const tokens = [
    `prompt=${usage.promptTokenCount ?? "?"}`,
    `output=${usage.candidatesTokenCount ?? "?"}`,
    usage.thoughtsTokenCount ? `thoughts=${usage.thoughtsTokenCount}` : null,
    usage.toolUsePromptTokenCount ? `toolUse=${usage.toolUsePromptTokenCount}` : null,
    `total=${usage.totalTokenCount ?? "?"}`
  ]
    .filter(Boolean)
    .join(" ");

  return `${cacheStatus}\n${COLORS.dim}tokens:${COLORS.reset} ${tokens}\n${COLORS.dim}${cost}${COLORS.reset}`;
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
      `\n${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.yellow}🤖 [Model Output]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset}\n${COLORS.dim}preview:${COLORS.reset} ${truncateMessage(content)}${usage ? `\n${formatModelUsage(usage)}` : ""}`
    );
  },
  synthesisOutput: (runId: string, content: string, usage?: ModelUsage) => {
    console.log(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.blue}✍️  [Synthesis]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset}\n${COLORS.dim}preview:${COLORS.reset} ${truncateMessage(content)}${usage ? `\n${formatModelUsage(usage)}` : ""}\n`
    );
  },
  agentResponse: (runId: string, content: string) => {
    console.log(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.green}💬 [Agent Response]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset}\n${COLORS.dim}preview:${COLORS.reset} ${truncateMessage(content)}\n`
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
