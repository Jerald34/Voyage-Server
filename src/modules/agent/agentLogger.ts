
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
  modelOutput: (runId: string, content: string) => {
    console.log(
      `\n${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.yellow}🤖 [Model Output]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset}\n${COLORS.yellow}--- CONTENT START ---${COLORS.reset}\n${content}\n${COLORS.yellow}--- CONTENT END ---\n${COLORS.reset}`
    );
  },
  synthesisOutput: (runId: string, content: string) => {
    console.log(
      `${COLORS.dim}[${formatTimestamp()}]${COLORS.reset} ${COLORS.blue}✍️  [Synthesis]${COLORS.reset} ${COLORS.dim}(Run: ${runId})${COLORS.reset}\n${content}\n`
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
