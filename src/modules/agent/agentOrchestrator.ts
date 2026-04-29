import { z } from "zod";
import { ApiError } from "../../http/errors";
import type { ModelProvider } from "../../services/modelProvider";
import type { AgentRunEventRecord, AgentRunRecord, AgentMessageRecord } from "./agentService";
import type { AgentEvent } from "./agentSchemas";
import type { AgentToolContext, AgentToolRegistry } from "./agentTools";

export type AgentOrchestratorRunInput = {
  agencyId: string;
  threadId: string;
  runId: string;
  userId: string;
  userContent: string;
};

export type AgentOrchestrator = {
  run(input: AgentOrchestratorRunInput): Promise<void>;
};

export type AgentOrchestratorAgentService = {
  startRun(runId: string, startedAt: Date): Promise<AgentRunRecord>;
  recordRunEvent(run: AgentRunRecord, event: AgentEvent): Promise<AgentRunEventRecord>;
  recordToolCallStarted(
    run: AgentRunRecord,
    input: { toolName: string; input: unknown },
    startedAt: Date
  ): Promise<{ id: string }>;
  completeToolCall(toolCallId: string, output: unknown, completedAt: Date): Promise<unknown>;
  failToolCall(toolCallId: string, code: string, message: string, completedAt: Date): Promise<unknown>;
  completeRun(
    runId: string,
    assistantContent: string
  ): Promise<{ run: AgentRunRecord; message: AgentMessageRecord }>;
  failRun(runId: string, code: string, message: string): Promise<AgentRunRecord>;
};

const modelToolCallSchema = z.object({
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({})
});

const modelJsonOutputSchema = z.object({
  assistantMessage: z.string().min(1).max(12000),
  toolCalls: z.array(modelToolCallSchema).default([])
});

function isLikelyJson(content: string) {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseModelOutput(content: string) {
  if (!isLikelyJson(content)) {
    return {
      type: "text" as const,
      assistantMessage: content
    };
  }

  try {
    return {
      type: "json" as const,
      ...modelJsonOutputSchema.parse(JSON.parse(content))
    };
  } catch {
    throw new ApiError(500, "MODEL_OUTPUT_INVALID", "Model output was not valid agent JSON.");
  }
}

function errorDetails(error: unknown) {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  return {
    code: "AGENT_RUN_FAILED",
    message: "Agent run failed."
  };
}

function stringifyToolResults(toolResults: Array<{ name: string; output: unknown }>) {
  const text = JSON.stringify(toolResults);
  if (text.length <= 12000) {
    return text;
  }
  return `${text.slice(0, 11997)}...`;
}

export function createAgentOrchestrator(options: {
  modelProvider: ModelProvider;
  agentService: AgentOrchestratorAgentService;
  toolRegistry: AgentToolRegistry;
  now?: () => Date;
  maxToolCallsPerRun?: number;
}): AgentOrchestrator {
  const now = options.now ?? (() => new Date());
  const maxToolCallsPerRun = options.maxToolCallsPerRun ?? 20;

  async function failRun(input: AgentOrchestratorRunInput, error: unknown) {
    const details = errorDetails(error);
    await options.agentService.failRun(input.runId, details.code, details.message);
  }

  async function streamAndComplete(run: AgentRunRecord, assistantMessage: string) {
    await options.agentService.recordRunEvent(run, {
      type: "message.delta",
      payload: { delta: assistantMessage }
    });
    await options.agentService.completeRun(run.id, assistantMessage);
  }

  return {
    async run(input) {
      const run = await options.agentService.startRun(input.runId, now());

      await options.agentService.recordRunEvent(run, {
        type: "run.started",
        payload: { runId: input.runId }
      });

      let modelContent: string;
      try {
        const modelResult = await options.modelProvider.complete({
          messages: [
            {
              role: "system",
              content:
                "You are an agency itinerary planning assistant. Return helpful text, or JSON with assistantMessage and toolCalls when tools are needed."
            },
            {
              role: "user",
              content: input.userContent
            }
          ],
          temperature: 0.2
        });
        modelContent = modelResult.content;
      } catch (error) {
        await failRun(input, error);
        return;
      }

      let parsedOutput: ReturnType<typeof parseModelOutput>;
      try {
        parsedOutput = parseModelOutput(modelContent);
      } catch (error) {
        await failRun(input, error);
        return;
      }

      if (parsedOutput.type === "text") {
        await streamAndComplete(run, parsedOutput.assistantMessage);
        return;
      }

      const context: AgentToolContext = {
        agencyId: input.agencyId,
        threadId: input.threadId,
        runId: input.runId,
        userId: input.userId
      };

      let toolCallsExecuted = 0;
      const toolResults: Array<{ name: string; output: unknown }> = [];
      for (const toolCall of parsedOutput.toolCalls) {
        if (toolCallsExecuted >= maxToolCallsPerRun) {
          await failRun(input, new ApiError(400, "AGENT_TOOL_LIMIT_REACHED", "Agent tool call limit reached."));
          return;
        }

        const startedAt = now();
        const persistedToolCall = await options.agentService.recordToolCallStarted(
          run,
          { toolName: toolCall.name, input: toolCall.input },
          startedAt
        );
        await options.agentService.recordRunEvent(run, {
          type: "tool.started",
          payload: { name: toolCall.name, input: toolCall.input }
        });
        toolCallsExecuted += 1;

        try {
          const output = await options.toolRegistry.execute(toolCall.name, context, toolCall.input);
          toolResults.push({ name: toolCall.name, output });
          await options.agentService.completeToolCall(persistedToolCall.id, output, now());
          await options.agentService.recordRunEvent(run, {
            type: "tool.completed",
            payload: { name: toolCall.name, output }
          });
        } catch (error) {
          const details = errorDetails(error);
          await options.agentService.failToolCall(persistedToolCall.id, details.code, details.message, now());
          await options.agentService.recordRunEvent(run, {
            type: "tool.failed",
            payload: { name: toolCall.name, code: details.code, message: details.message }
          });
          await failRun(input, error);
          return;
        }
      }

      if (toolResults.length === 0) {
        await streamAndComplete(run, parsedOutput.assistantMessage);
        return;
      }

      let synthesizedMessage = parsedOutput.assistantMessage;
      try {
        const synthesis = await options.modelProvider.complete({
          messages: [
            {
              role: "system",
              content:
                "You are an agency itinerary planning assistant. Write the final assistant response for agency staff using the tool results. Mention concrete itinerary, map, and search outcomes when available."
            },
            {
              role: "user",
              content: input.userContent
            },
            {
              role: "assistant",
              content: parsedOutput.assistantMessage
            },
            {
              role: "user",
              content: `Tool results JSON:\n${stringifyToolResults(toolResults)}`
            }
          ],
          temperature: 0.2
        });
        synthesizedMessage = synthesis.content.trim() || parsedOutput.assistantMessage;
      } catch {
        synthesizedMessage = parsedOutput.assistantMessage;
      }

      await streamAndComplete(run, synthesizedMessage);
    }
  };
}
