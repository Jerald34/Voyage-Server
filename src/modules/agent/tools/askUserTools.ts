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
