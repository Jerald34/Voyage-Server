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

const ITINERARY_TOOL_NAMES = new Set([
  "create_itinerary",
  "update_itinerary",
  "plan_itinerary",
  "add_itinerary_day",
  "update_itinerary_day",
  "remove_itinerary_day",
  "add_itinerary_item",
  "update_itinerary_item",
  "remove_itinerary_item",
  "move_itinerary_item",
  "delete_itinerary"
]);

// Only the granular Approach-B tools should trigger the multi-turn continuation loop.
// Legacy create_itinerary/update_itinerary are one-shot and were never expected to chain.
const GRANULAR_ITINERARY_TOOL_NAMES = new Set([
  "plan_itinerary",
  "add_itinerary_day",
  "update_itinerary_day",
  "remove_itinerary_day",
  "add_itinerary_item",
  "update_itinerary_item",
  "remove_itinerary_item",
  "move_itinerary_item"
]);

// Tools that are progress-tracking or research actions — they should always trigger a
// continuation turn so the agent keeps working after recording a task or searching the web.
const CONTINUATION_TRIGGER_TOOL_NAMES = new Set([
  "record_agent_task",
  "web_search",
  "search_google_places",
  "get_google_place_details",
  "estimate_route",
  "map_pinpoint",
  "route_logistics",
  "place_insights",
  "search_nearby_google_places",
  "get_google_place_photos"
]);

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
      typeof payload.name === "string" &&
      ITINERARY_TOOL_NAMES.has(payload.name);
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
        "The user may ask to modify this draft. Prefer the granular tools (update_itinerary_item, add_itinerary_item, remove_itinerary_item, move_itinerary_item, add/update/remove_itinerary_day) so changes stream as discrete events.",
        "Reserve update_itinerary (full replacement) for explicit wholesale-rewrite requests."
      ].join("\n"),
      itinerary
    };
  }

  return null;
}

// Update the in-memory itinerary cache after a granular tool call so the agent's next turn sees a fresh snapshot.
function applyToolResultToItineraryContext(
  context: { prompt: string; itinerary: Record<string, unknown> } | null,
  toolName: string,
  output: unknown
) {
  if (!ITINERARY_TOOL_NAMES.has(toolName) || !isRecordLike(output)) {
    return context;
  }

  // create_itinerary/update_itinerary return the full itinerary at the root or under .itinerary.
  // The granular tools return { itinerary, ... } where itinerary is a full snapshot.
  const updatedItinerary = extractItineraryFromToolOutput(
    isRecordLike((output as Record<string, unknown>).itinerary)
      ? (output as Record<string, unknown>).itinerary
      : output
  );
  if (!updatedItinerary) {
    return context;
  }

  // delete_itinerary clears the active context.
  if (toolName === "delete_itinerary") {
    return null;
  }

  return {
    prompt: context?.prompt ??
      [
        "Active itinerary draft context",
        "The user may ask to modify this draft. Prefer the granular tools (update_itinerary_item, add_itinerary_item, remove_itinerary_item, move_itinerary_item, add/update/remove_itinerary_day) so changes stream as discrete events.",
        "Reserve update_itinerary (full replacement) for explicit wholesale-rewrite requests."
      ].join("\n"),
    itinerary: updatedItinerary
  };
}

// Count items across all days. Used to detect premature termination after plan_itinerary
// (model jumps to plain text before populating any stops).
function countItineraryItems(itinerary: Record<string, unknown> | undefined | null): { dayCount: number; itemCount: number } {
  if (!isRecordLike(itinerary) || !Array.isArray(itinerary.days)) {
    return { dayCount: 0, itemCount: 0 };
  }
  const days = itinerary.days as Array<unknown>;
  let itemCount = 0;
  for (const day of days) {
    if (isRecordLike(day) && Array.isArray(day.items)) {
      itemCount += (day.items as Array<unknown>).length;
    }
  }
  return { dayCount: days.length, itemCount };
}

// Surface the canonical UUIDs back to the model so it cannot fabricate slug-style IDs on continuation turns.
// Returns "" when the itinerary is missing or malformed so callers can safely append the result without
// emitting an empty system message.
function buildItineraryIdentifierBlock(itinerary: Record<string, unknown> | undefined | null): string {
  if (!itinerary || typeof itinerary !== "object") {
    return "";
  }

  const itineraryId = typeof itinerary.id === "string" ? itinerary.id : null;
  if (!itineraryId) {
    return "";
  }

  const lines: string[] = [
    "Active itinerary identifiers (use these EXACT UUIDs, do not fabricate IDs):",
    `- itineraryId: ${itineraryId}`
  ];

  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  const itemLines: string[] = [];
  for (const day of days) {
    if (!isRecordLike(day)) {
      continue;
    }
    const dayId = typeof day.id === "string" ? day.id : null;
    if (!dayId) {
      continue;
    }
    const dayNumber = typeof day.dayNumber === "number" ? day.dayNumber : null;
    const dayTitle = typeof day.title === "string" ? day.title : "";
    const label = dayNumber !== null ? `Day ${dayNumber}` : "Day";
    const titleSuffix = dayTitle ? ` (${dayTitle})` : "";
    lines.push(`- ${label}${titleSuffix}: dayId = ${dayId}`);

    const items = Array.isArray(day.items) ? day.items : [];
    for (const item of items) {
      if (!isRecordLike(item)) {
        continue;
      }
      const itemId = typeof item.id === "string" ? item.id : null;
      if (!itemId) {
        continue;
      }
      const sortOrder = typeof item.sortOrder === "number" ? item.sortOrder : null;
      const title = typeof item.title === "string" ? item.title : "";
      const sortLabel = sortOrder !== null ? `sortOrder ${sortOrder}` : "(unknown order)";
      itemLines.push(
        `  - ${label} / ${sortLabel}: itemId = ${itemId}${title ? `, title = ${title}` : ""}`
      );
    }
  }

  if (itemLines.length > 0) {
    lines.push("- Existing items:");
    lines.push(...itemLines);
  }

  return lines.join("\n");
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
  // Packed Approach B with research + clustering + per-stop estimate_route fans out to ~3 tool calls per stop on a multi-day plan.
  const maxToolCallsPerRun = options.maxToolCallsPerRun ?? 120;
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

          const initialIdentifierBlock = activeItineraryContext
            ? buildItineraryIdentifierBlock(activeItineraryContext.itinerary)
            : "";

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
            ...(initialIdentifierBlock
              ? [
                {
                  role: "system" as const,
                  content: initialIdentifierBlock
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
                temperature: 0.6
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
              temperature: 0.6
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
        let hadRecoverableFailure = false;
        const toolResults: Array<{ name: string; output: unknown }> = [];

        async function executeToolCallsBatch(toolCalls: Array<{ name: string; input: Record<string, unknown> }>) {
          for (const toolCall of toolCalls) {
            if (toolCallsExecuted >= maxToolCallsPerRun) {
              throw new ApiError(400, "AGENT_TOOL_LIMIT_REACHED", "Agent tool call limit reached.");
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
              activeItineraryContext = applyToolResultToItineraryContext(
                activeItineraryContext,
                toolCall.name,
                output
              );
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

              // Any 400-class tool input error is recoverable: feed the error message back as a tool
              // result so the next continuation turn can self-correct rather than failing the whole run.
              // Also covers granular itinerary tools rejecting malformed UUIDs / missing itineraries.
              const isCorrectableInputFailure =
                details.code === "AGENT_TOOL_INPUT_INVALID" ||
                (GRANULAR_ITINERARY_TOOL_NAMES.has(toolCall.name) && details.code === "ITINERARY_NOT_FOUND");
              if (isCorrectableInputFailure) {
                toolResults.push({
                  name: toolCall.name,
                  output: {
                    error: true,
                    code: details.code,
                    message: details.message
                  }
                });
                hadRecoverableFailure = true;
                continue;
              }

              throw error;
            }
          }
        }

        try {
          await executeToolCallsBatch(parsedOutput.toolCalls);
        } catch (error) {
          await failRun(input, error);
          return;
        }

        // Approach B continuation loop: when the agent invoked an itinerary-building tool, give it more turns
        // so it can keep streaming items left-to-right (plan_itinerary -> add_itinerary_item x N -> ...).
        // We stop when the model responds with plain text, when no itinerary tool was called, or when the cap is hit.
        const maxContinuations = 100;
        let continuationsRun = 0;
        let lastAssistantMessage = parsedOutput.assistantMessage;
        let lastInvokedItineraryTool = parsedOutput.toolCalls.some((c: { name: string }) =>
          GRANULAR_ITINERARY_TOOL_NAMES.has(c.name)
        );
        const lastInvokedContinuationTool = parsedOutput.toolCalls.some((c: { name: string }) =>
          CONTINUATION_TRIGGER_TOOL_NAMES.has(c.name)
        );
        // A recoverable input failure (e.g. record_agent_task with a malformed shape) should still
        // trigger a continuation so the model can self-correct, even if no itinerary tool ran.
        // Progress-tracking / research tools (record_agent_task, web_search, etc.) must also
        // trigger continuation so the agent proceeds to the actual work after recording status.
        let shouldContinueLoop = lastInvokedItineraryTool || lastInvokedContinuationTool || hadRecoverableFailure;
        // Track remediation attempts so the model can't terminate prematurely after plan_itinerary
        // when the itinerary still has empty days. Capped to avoid infinite loops on a stuck model.
        let remediationAttempts = 0;
        const maxRemediationAttempts = 3;

        while (shouldContinueLoop && continuationsRun < maxContinuations && toolCallsExecuted < maxToolCallsPerRun) {
          continuationsRun += 1;
          hadRecoverableFailure = false;
          const { dayCount: currentDayCount, itemCount: currentItemCount } = countItineraryItems(activeItineraryContext?.itinerary);
          const itineraryIsEmptySkeleton = currentDayCount > 0 && currentItemCount === 0;

          const continuationIdentifierBlock = activeItineraryContext
            ? buildItineraryIdentifierBlock(activeItineraryContext.itinerary)
            : "";

          const continuationMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
            {
              role: "system" as const,
              content: buildVoyageSystemPrompt(toolListForPrompt)
            },
            ...(activeItineraryContext
              ? [{ role: "system" as const, content: activeItineraryContext.prompt }]
              : []),
            ...(continuationIdentifierBlock
              ? [{ role: "system" as const, content: continuationIdentifierBlock }]
              : []),
            {
              role: "user" as const,
              content: input.userContent
            },
            {
              role: "assistant" as const,
              content: lastAssistantMessage
            },
            {
              role: "user" as const,
              content: [
                "Tool results so far (most recent last):",
                stringifyToolResults(toolResults),
                "",
                activeItineraryContext
                  ? `Current itinerary draft state:\n${JSON.stringify(activeItineraryContext.itinerary)}`
                  : "",
                "",
                itineraryIsEmptySkeleton
                  ? `STATE CHECK: The itinerary has ${currentDayCount} day(s) but ZERO items so far. The plan is NOT complete. Your next response MUST be a single add_itinerary_item tool call (or estimate_route to validate the route before the next add). Do NOT respond with plain text yet. Do NOT call plan_itinerary again — the skeleton already exists. Begin populating Day 1.`
                  : "If the itinerary still needs more stops to fulfil the original request, respond with the next single tool call (preferably add_itinerary_item, one item at a time). When the itinerary is complete, respond with a brief plain-text summary and no tool call."
              ].filter(Boolean).join("\n")
            }
          ];

          let nextContent: string;
          try {
            const completion = await options.modelProvider.complete({
              messages: continuationMessages,
              temperature: 0.6
            });
            nextContent = completion.content;
            agentLogger.modelOutput(input.runId, nextContent);
          } catch (error) {
            agentLogger.error("Continuation completion failed", input.runId, error);
            break;
          }

          let nextParsed: any;
          try {
            nextParsed = parseModelOutput(nextContent);
          } catch (error) {
            agentLogger.error("Continuation parse failed", input.runId, error);
            break;
          }

          if (nextParsed.type === "text" || !nextParsed.toolCalls?.length) {
            // Anti-termination guard: if the model tries to terminate while the itinerary still
            // has empty days (skeleton-only), force more turns up to maxRemediationAttempts.
            const postTurn = countItineraryItems(activeItineraryContext?.itinerary);
            const stillEmpty = postTurn.dayCount > 0 && postTurn.itemCount === 0;
            if (stillEmpty && remediationAttempts < maxRemediationAttempts) {
              remediationAttempts += 1;
              agentLogger.debug(
                input.runId,
                `Premature termination after plan_itinerary; remediating (attempt ${remediationAttempts}/${maxRemediationAttempts})`
              );
              lastAssistantMessage = nextParsed.assistantMessage || lastAssistantMessage;
              shouldContinueLoop = true;
              continue;
            }
            lastAssistantMessage = nextParsed.assistantMessage || lastAssistantMessage;
            lastInvokedItineraryTool = false;
            shouldContinueLoop = false;
            break;
          }

          lastAssistantMessage = nextParsed.assistantMessage || lastAssistantMessage;
          try {
            await executeToolCallsBatch(nextParsed.toolCalls);
          } catch (error) {
            await failRun(input, error);
            return;
          }
          lastInvokedItineraryTool = nextParsed.toolCalls.some((c: { name: string }) =>
            GRANULAR_ITINERARY_TOOL_NAMES.has(c.name)
          );
          const continuationTool = nextParsed.toolCalls.some((c: { name: string }) =>
            CONTINUATION_TRIGGER_TOOL_NAMES.has(c.name)
          );
          shouldContinueLoop = lastInvokedItineraryTool || continuationTool || hadRecoverableFailure;
        }

        // Update the assistantMessage seed used by synthesis to the last continuation if we ran one.
        parsedOutput = { ...parsedOutput, assistantMessage: lastAssistantMessage };

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
            temperature: 0.6
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
