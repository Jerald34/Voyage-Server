import { ApiError } from "../../http/errors";
import type { ModelProvider } from "../../services/modelProvider";
import type { AgentRunRecord, AgentMessageRecord, AgentRunEventRecord } from "./agentTypes";
import { agentLogger } from "./agentLogger";
import type { AgentEvent } from "./agentSchemas";
import type { AgentToolContext, AgentToolRegistry } from "./agentTools";
import type { 
  AgentOrchestrator, 
  AgentOrchestratorRunInput, 
  AgentOrchestratorAgentService 
} from "./agentTypes";
import { 
  parseModelOutput, 
  canonicalToolName 
} from "./agentParser";
import { 
  buildVoyageSystemPrompt, 
  buildVoyageSynthesisPrompt 
} from "./agentPrompts";
import { 
  shouldRecoverPlainItinerary, 
  recoverPlainItineraryToolOutput, 
  shouldCreateItineraryDirectlyFromUserRequest, 
  createItineraryToolCallFromUserRequest,
  enrichToolInputFromUserRequestForExecution,
  mergeUpdateItineraryInputFromActiveItinerary
} from "./agentInference";
import { 
  errorDetails, 
  recoverSynthesizedMessage,
  stringifyToolResults 
} from "./agentUtils";

async function streamModelCompletion(options: {
  modelProvider: ModelProvider;
  input: { messages: Array<{ role: "system" | "user" | "assistant"; content: string }>; temperature?: number };
  onDelta: (delta: string) => Promise<void>;
}) {
  if (!options.modelProvider.completeStream) {
    return null;
  }

  let content = "";
  for await (const delta of options.modelProvider.completeStream(options.input)) {
    if (!delta) {
      continue;
    }
    content += delta;
    await options.onDelta(delta);
  }

  return content;
}

function detectInitialOutputMode(content: string) {
  const trimmed = content.trimStart();
  if (!trimmed) {
    return "text" as const;
  }
  return trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("<|toolcall|>") ||
    trimmed.startsWith("<|tool_call>") ||
    trimmed.startsWith("<tool_call>") ||
    trimmed.startsWith("<tool_call|>") ||
    trimmed.startsWith('"')
    ? ("json" as const)
    : ("text" as const);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractItineraryFromToolOutput(output: unknown) {
  if (!isRecordLike(output)) {
    return null;
  }

  const itinerary = isRecordLike(output.itinerary) ? output.itinerary : output;
  if (typeof itinerary.id !== "string" || !Array.isArray(itinerary.days)) {
    return null;
  }

  return itinerary;
}

function buildActiveItineraryContext(thread: unknown) {
  if (!isRecordLike(thread) || !Array.isArray(thread.events)) {
    return null;
  }

  for (const event of [...thread.events].reverse()) {
    if (!isRecordLike(event) || !isRecordLike(event.payload)) {
      continue;
    }

    const payload = event.payload;
    const isItineraryTool =
      event.type === "tool.completed" &&
      (payload.name === "create_itinerary" || payload.name === "update_itinerary");
    if (!isItineraryTool) {
      continue;
    }

    const itinerary = extractItineraryFromToolOutput(payload.output);
    if (!itinerary) {
      continue;
    }

    return {
      prompt: [
        "Active itinerary draft context",
        "The user may ask to modify this draft. For add, remove, replace, shorten, extend, reorder, or revise requests, call update_itinerary with this itinerary id and a full replacement itinerary that preserves unchanged days/items.",
        "For update_itinerary, include the itineraryId and a complete itinerary object with title, days, and every required day/item field. Do not omit item type or title."
      ].join("\n"),
      itinerary
    };
  }

  return null;
}

function availableToolSet(toolNames: string[]) {
  return new Set(toolNames.map((name) => canonicalToolName(name)));
}

export function createAgentOrchestrator(options: {
  modelProvider: ModelProvider;
  agentService: AgentOrchestratorAgentService;
  toolRegistry: AgentToolRegistry;
  availableToolNames?: string[];
  now?: () => Date;
  maxToolCallsPerRun?: number;
}): AgentOrchestrator {
  const now = options.now ?? (() => new Date());
  const maxToolCallsPerRun = options.maxToolCallsPerRun ?? 20;
  const historyMessageLimit = 30;
  const availableToolNames = options.availableToolNames ?? [];
  const tools = availableToolSet(availableToolNames);
  const toolListForPrompt = availableToolNames.length > 0 ? availableToolNames.join(", ") : "(none)";

  async function failRun(input: AgentOrchestratorRunInput, error: unknown) {
    const details = errorDetails(error);
    agentLogger.error("Agent Run Failed", input.runId, { code: details.code, message: details.message, error });
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
    toolRegistry: options.toolRegistry,
    async run(input) {
      agentLogger.debug(input.runId, `Starting run for thread ${input.threadId}`);
      const run = await options.agentService.startRun(input.runId, now());
      try {
        await options.agentService.recordRunEvent(run, {
          type: "run.started",
          payload: { runId: input.runId }
        });

        let conversationHistory: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
        let activeItineraryContext: { prompt: string; itinerary: Record<string, unknown> } | null = null;
        try {
          const thread = await options.agentService.getThread(input.agencyId, input.threadId);
          activeItineraryContext = buildActiveItineraryContext(thread);
          const recentMessages = (thread as any).messages.slice(-historyMessageLimit);
          conversationHistory = recentMessages
            .map((message: any) => {
              if (message.role === "USER") {
                return { role: "user" as const, content: message.content };
              }
              if (message.role === "ASSISTANT") {
                return { role: "assistant" as const, content: message.content };
              }
              return { role: "system" as const, content: message.content };
            })
            .filter((message: any) => message.content.trim().length > 0);
        } catch {
          // If history lookup fails, continue with the current message only.
        }

        let modelContent = "";
        let initialMode: "text" | "json" = "text";
        let recoveryNotified = false;
        try {
          const historyOrCurrent =
            conversationHistory.length > 0
              ? conversationHistory
              : [
                {
                  role: "user" as const,
                  content: input.userContent
                }
              ];

          const initialMessages = [
            {
              role: "system" as const,
              content: buildVoyageSystemPrompt(toolListForPrompt)
            },
            ...(activeItineraryContext
              ? [
                {
                  role: "system" as const,
                  content: activeItineraryContext.prompt
                }
              ]
              : []),
            ...historyOrCurrent
          ];
          if (options.modelProvider.completeStream) {
            const streamed = await streamModelCompletion({
              modelProvider: options.modelProvider,
              input: {
                messages: initialMessages,
                temperature: 0.2
              },
              onDelta: async (delta) => {
                modelContent += delta;
                initialMode = detectInitialOutputMode(modelContent);
                const isRecoveryCandidate = initialMode === "text" && shouldRecoverPlainItinerary({
                  tools,
                  userContent: input.userContent,
                  modelContent
                });
                if (initialMode === "text" && !isRecoveryCandidate) {
                  await options.agentService.recordRunEvent(run, {
                    type: "message.delta",
                    payload: { delta }
                  });
                } else if (isRecoveryCandidate && !recoveryNotified) {
                  recoveryNotified = true;
                  await options.agentService.recordRunEvent(run, {
                    type: "message.delta",
                    payload: { delta: "\n\n_Drafting your itinerary..._" }
                  });
                }
              }
            });

            if (typeof streamed === "string") {
              modelContent = streamed;
              initialMode = detectInitialOutputMode(modelContent);
            }
          } else {
            const modelResult = await options.modelProvider.complete({
              messages: initialMessages,
              temperature: 0.2
            });
            modelContent = modelResult.content;
            initialMode = detectInitialOutputMode(modelContent);
          }

          agentLogger.modelOutput(input.runId, modelContent);
        } catch (error) {
          await failRun(input, error);
          return;
        }

        let parsedOutput: any = null;
        if (initialMode === "text") {
          if (
            shouldRecoverPlainItinerary({
              tools,
              userContent: input.userContent,
              modelContent
            })
          ) {
            try {
              parsedOutput = await recoverPlainItineraryToolOutput({
                modelProvider: options.modelProvider,
                userContent: input.userContent,
                assistantContent: modelContent
              });
            } catch {
              parsedOutput = null;
            }
          }
        }

        if (!parsedOutput) {
          try {
            parsedOutput = parseModelOutput(modelContent);
          } catch (error) {
            if (
              shouldCreateItineraryDirectlyFromUserRequest({
                tools,
                userContent: input.userContent
              })
            ) {
              parsedOutput = createItineraryToolCallFromUserRequest(input.userContent);
            }

            if (!parsedOutput) {
              await failRun(input, error);
              return;
            }
          }
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
          const toolInput = await enrichToolInputFromUserRequestForExecution({
            modelProvider: options.modelProvider,
            toolName: toolCall.name,
            input: toolCall.input,
            userContent: input.userContent
          });
          const normalizedToolInput =
            toolCall.name === "update_itinerary" && activeItineraryContext
              ? mergeUpdateItineraryInputFromActiveItinerary({
                input: toolInput,
                activeItinerary: activeItineraryContext.itinerary
              })
              : toolInput;
          const persistedToolCall = await options.agentService.recordToolCallStarted(
            run,
            { toolName: toolCall.name, input: normalizedToolInput },
            startedAt
          );
          await options.agentService.recordRunEvent(run, {
            type: "tool.started",
            payload: { name: toolCall.name, input: normalizedToolInput }
          });
          toolCallsExecuted += 1;

          try {
            const output = await options.toolRegistry.execute(toolCall.name, context, normalizedToolInput);
            toolResults.push({ name: toolCall.name, output });
            await options.agentService.completeToolCall(persistedToolCall.id, output, now());
            await options.agentService.recordRunEvent(run, {
              type: "tool.completed",
              payload: { name: toolCall.name, output }
            });
          } catch (error) {
            agentLogger.error(`Tool Execution Failed: ${toolCall.name}`, input.runId, error);
            const details = errorDetails(error);
            await options.agentService.failToolCall(persistedToolCall.id, details.code, details.message, now());
            await options.agentService.recordRunEvent(run, {
              type: "tool.failed",
              payload: { name: toolCall.name, code: details.code, message: details.message }
            });

            const isRecoverableToolFailure =
              (toolCall.name === "web_search" && details.code === "WEB_SEARCH_PROVIDER_UNAVAILABLE") ||
              ([
                "search_google_places",
                "get_google_place_details",
                "estimate_route",
                "map_pinpoint",
                "route_logistics",
                "place_insights"
              ].includes(toolCall.name) &&
                (details.code === "MAPS_PROVIDER_UNAVAILABLE" || details.code === "AGENT_TOOL_LIMIT_REACHED"));
            if (isRecoverableToolFailure) {
              toolResults.push({
                name: toolCall.name,
                output: {
                  unavailable: true,
                  code: details.code,
                  message: details.message
                }
              });
              continue;
            }

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
          const synthesisMessages = [
            {
              role: "system" as const,
              content: buildVoyageSynthesisPrompt()
            },
            {
              role: "user" as const,
              content: input.userContent
            },
            {
              role: "assistant" as const,
              content: parsedOutput.assistantMessage
            },
            {
              role: "user" as const,
              content: `Tool results JSON:\n${stringifyToolResults(toolResults)}`
            }
          ];

          const synthesis = await options.modelProvider.complete({
            messages: synthesisMessages,
            temperature: 0.2
          });
          synthesizedMessage = recoverSynthesizedMessage(
            synthesis.content.trim() || parsedOutput.assistantMessage,
            toolResults,
            parsedOutput.assistantMessage
          );
          agentLogger.synthesisOutput(input.runId, synthesizedMessage);
        } catch {
          synthesizedMessage = parsedOutput.assistantMessage;
          agentLogger.error("Synthesis Failed", input.runId, "Falling back to assistant message.");
        }

        await options.agentService.recordRunEvent(run, {
          type: "message.delta",
          payload: { delta: synthesizedMessage }
        });
        await options.agentService.completeRun(run.id, synthesizedMessage);

      } finally {
        options.toolRegistry.clearRun?.(input.runId);
      }
    }
  };
}
