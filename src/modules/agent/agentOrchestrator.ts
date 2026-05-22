import { ApiError } from "../../http/errors";
import type { ModelProvider, ModelUsage, ModelMessage, ModelMessagePart } from "../../services/modelProvider";
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
  parseModelOutput
} from "./agentParser";
import {
  buildVoyageSystemPrompt,
  buildVoyageSynthesisPrompt
} from "./agentPrompts";
import {
  shouldRecoverPlainItinerary,
  shouldCreateItineraryDirectlyFromUserRequest,
  createItineraryToolCallFromUserRequest
} from "./agentHeuristics";
import {
  recoverPlainItineraryToolOutput,
  enrichToolInputFromUserRequestForExecution,
  mergeUpdateItineraryInputFromActiveItinerary
} from "./agentInputEnricher";
import {
  errorDetails,
  recoverSynthesizedMessage,
  stringifyToolResults
} from "./agentUtils";
import {
  detectInitialOutputMode,
  GRANULAR_ITINERARY_TOOL_NAMES,
  CONTINUATION_TRIGGER_TOOL_NAMES,
  buildActiveItineraryContext,
  applyToolResultToItineraryContext,
  countItineraryItems,
  availableToolSet,
  buildRuntimeContextBlock,
  injectRuntimeContextIntoLastUser,
  makeCompactToolOutput
} from "./agentContextBuilder";

async function streamModelCompletion(options: {
  modelProvider: ModelProvider;
  input: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
  };
  onDelta: (delta: string) => Promise<void>;
}) {
  if (!options.modelProvider.completeStream) {
    return null;
  }

  let content = "";
  let usage: ModelUsage | undefined;
  for await (const delta of options.modelProvider.completeStream({
    ...options.input,
    onUsage: (nextUsage) => {
      usage = nextUsage;
    }
  })) {
    if (!delta) {
      continue;
    }
    content += delta;
    await options.onDelta(delta);
  }

  return { content, usage };
}

// Cap kept per continuation turn so the prompt grows linearly with the latest few results
// instead of accumulating every prior add_itinerary_item echo. The full itinerary state is
// still passed via activeItineraryContext.itinerary, so trimming history does not lose truth.
const CONTINUATION_TOOL_RESULTS_TAIL = 3;
const SYNTHESIS_TOOL_RESULTS_TAIL = 5;

export function createAgentOrchestrator(options: {
  modelProvider: ModelProvider;
  agentService: AgentOrchestratorAgentService;
  toolRegistry: AgentToolRegistry;
  availableToolNames?: string[];
  now?: () => Date;
  maxToolCallsPerRun?: number;
  /** Awaited before completeRun so enriched PlaceSnapshots (photos, ratings)
   *  are in the DB when the client re-fetches. */
  onBeforeRunComplete?: (itinerary: Record<string, unknown>) => Promise<void>;
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
      const signal = input.signal;

      function checkCancelled() {
        if (signal?.aborted) {
          throw new ApiError(499, "USER_CANCELLED", "Run cancelled by user.");
        }
      }

      const run = await options.agentService.startRun(input.runId, now());
      try {
        await options.agentService.recordRunEvent(run, {
          type: "run.started",
          payload: { runId: input.runId }
        });

        let conversationHistory: ModelMessage[] = [];
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

        // Build multimodal image parts for the current user message if images were attached.
        let userImageParts: ModelMessagePart[] = [];
        if (input.imageUrls?.length) {
          try {
            const fetched = await Promise.all(
              input.imageUrls.map(async (url) => {
                const response = await fetch(url);
                if (!response.ok) return null;
                const buffer = Buffer.from(await response.arrayBuffer());
                const mimeType = response.headers.get("content-type") || "image/jpeg";
                return { inlineData: { mimeType, data: buffer.toString("base64") } } as ModelMessagePart;
              })
            );
            userImageParts = fetched.filter((part): part is ModelMessagePart => part !== null);
          } catch {
            // If image fetch fails, continue with text-only — don't block the run.
          }
        }

        let modelContent = "";
        let modelUsage: ModelUsage | undefined;
        let initialMode: "text" | "json" = "text";
        let recoveryNotified = false;
        try {
          const historyOrCurrent: ModelMessage[] =
            conversationHistory.length > 0
              ? conversationHistory
              : [
                {
                  role: "user" as const,
                  content: input.userContent
                }
              ];

          // Attach image parts to the last user message in the conversation.
          if (userImageParts.length > 0) {
            let lastUserIdx = -1;
            for (let i = historyOrCurrent.length - 1; i >= 0; i--) {
              if (historyOrCurrent[i].role === "user") { lastUserIdx = i; break; }
            }
            if (lastUserIdx >= 0) {
              const lastUserMsg = historyOrCurrent[lastUserIdx];
              historyOrCurrent[lastUserIdx] = {
                ...lastUserMsg,
                parts: [{ text: lastUserMsg.content }, ...userImageParts]
              };
            }
          }

          const initialRuntimeContext = buildRuntimeContextBlock(activeItineraryContext);
          const historyWithContext = injectRuntimeContextIntoLastUser(
            historyOrCurrent,
            initialRuntimeContext
          );

          const initialMessages = [
            {
              role: "system" as const,
              content: buildVoyageSystemPrompt(toolListForPrompt)
            },
            ...historyWithContext
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
                // Require at least 200 chars before considering recovery — early chunks
                // like "Before I draft the itinerary..." are conversational, not actual itineraries.
                const isRecoveryCandidate = initialMode === "text" && modelContent.length >= 200 && shouldRecoverPlainItinerary({
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

            if (streamed && typeof streamed.content === "string") {
              modelContent = streamed.content;
              modelUsage = streamed.usage;
              initialMode = detectInitialOutputMode(modelContent);
            }
          } else {
            const modelResult = await options.modelProvider.complete({
              messages: initialMessages,
              temperature: 0.6
            });
            modelContent = modelResult.content;
            modelUsage = modelResult.usage;
            initialMode = detectInitialOutputMode(modelContent);
          }

          agentLogger.modelOutput(input.runId, modelContent, modelUsage);
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

        // Track how many times each item is touched by editing tools to detect cascade loops
        // where the agent repeatedly adjusts times/positions without converging.
        // Two-tier system:
        //   - "warning" (soft): inject guidance to wrap up — the agent may still have work to do
        //   - "looping" (hard): force-break the loop — the agent is clearly going in circles
        const itemTouchCounts = new Map<string, number>();
        const EDIT_TOOL_NAMES = new Set(["update_itinerary_item", "move_itinerary_item", "remove_itinerary_item"]);
        function trackItemTouch(toolName: string, toolInput: Record<string, unknown>) {
          const itemId = typeof toolInput.itemId === "string" ? toolInput.itemId : null;
          if (itemId && EDIT_TOOL_NAMES.has(toolName)) {
            itemTouchCounts.set(itemId, (itemTouchCounts.get(itemId) || 0) + 1);
          }
          // Detect duplicate add_itinerary_item calls by title (e.g. adding airport arrival twice)
          if (toolName === "add_itinerary_item") {
            const item = typeof toolInput.item === "object" && toolInput.item !== null ? toolInput.item as Record<string, unknown> : null;
            const title = typeof item?.title === "string" ? item.title : null;
            if (title) {
              const addKey = `add:${title.toLowerCase().trim()}`;
              itemTouchCounts.set(addKey, (itemTouchCounts.get(addKey) || 0) + 1);
            }
          }
        }
        function maxItemTouches(): number {
          let max = 0;
          for (const count of itemTouchCounts.values()) {
            if (count > max) max = count;
          }
          return max;
        }
        // Soft warning: agent should start wrapping up, but can finish current work
        function isEditCascading(): boolean {
          return maxItemTouches() >= 5;
        }
        // Hard loop: agent is oscillating and will never converge — force-break
        function isEditLooping(): boolean {
          return maxItemTouches() >= 8;
        }

        async function executeToolCallsBatch(toolCalls: Array<{ name: string; input: Record<string, unknown> }>) {
          for (const toolCall of toolCalls) {
            checkCancelled();
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
            const [persistedToolCall] = await Promise.all([
              options.agentService.recordToolCallStarted(
                run,
                { toolName: toolCall.name, input: normalizedToolInput },
                startedAt
              ),
              options.agentService.recordRunEvent(run, {
                type: "tool.started",
                payload: { name: toolCall.name, input: normalizedToolInput }
              })
            ]);
            toolCallsExecuted += 1;

            try {
              const output = await options.toolRegistry.execute(toolCall.name, context, normalizedToolInput);
              // Update the in-memory active itinerary BEFORE compacting, so the running
              // state captures the full snapshot. After that, the orchestrator only needs a
              // compact delta in `toolResults` — the full itinerary is reachable via
              // `activeItineraryContext` for in-loop prompts and via the persisted
              // `tool.completed` event for cross-message recovery.
              trackItemTouch(toolCall.name, normalizedToolInput);
              activeItineraryContext = applyToolResultToItineraryContext(
                activeItineraryContext,
                toolCall.name,
                output
              );
              const compactOutput = makeCompactToolOutput(toolCall.name, output);
              toolResults.push({ name: toolCall.name, output: compactOutput });
              await Promise.all([
                options.agentService.completeToolCall(persistedToolCall.id, output, now()),
                options.agentService.recordRunEvent(run, {
                  type: "tool.completed",
                  payload: { name: toolCall.name, output }
                })
              ]);
            } catch (error) {
              agentLogger.error(`Tool Execution Failed: ${toolCall.name}`, input.runId, error);
              const details = errorDetails(error);
              await Promise.all([
                options.agentService.failToolCall(persistedToolCall.id, details.code, details.message, now()),
                options.agentService.recordRunEvent(run, {
                  type: "tool.failed",
                  payload: { name: toolCall.name, code: details.code, message: details.message }
                })
              ]);

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
          if (signal?.aborted) { agentLogger.debug(input.runId, "Run cancelled by user"); return; }
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

        // Build conversation history prefix for continuation context.
        // Without this, the continuation only sees the latest user message and loses
        // preferences from earlier turns (e.g., "1 week", "public transpo", "relaxed pace").
        const priorHistory = conversationHistory.filter(m => m.role !== "system").slice(0, -1);
        const maxPriorMessages = 10;
        let historyPrefix = priorHistory.slice(-maxPriorMessages);
        // Ensure valid alternation: starts with user, ends with assistant
        if (historyPrefix.length > 0 && historyPrefix[0].role !== "user") {
          historyPrefix = historyPrefix.slice(1);
        }
        if (historyPrefix.length > 0 && historyPrefix[historyPrefix.length - 1].role !== "assistant") {
          historyPrefix = historyPrefix.slice(0, -1);
        }

        while (shouldContinueLoop && continuationsRun < maxContinuations && toolCallsExecuted < maxToolCallsPerRun) {
          checkCancelled();
          continuationsRun += 1;
          hadRecoverableFailure = false;
          const { dayCount: currentDayCount, itemCount: currentItemCount } = countItineraryItems(activeItineraryContext?.itinerary);
          const itineraryIsEmptySkeleton = currentDayCount > 0 && currentItemCount === 0;

          const continuationRuntimeContext = buildRuntimeContextBlock(activeItineraryContext);
          const recentToolResults = toolResults.slice(-CONTINUATION_TOOL_RESULTS_TAIL);
          const omittedToolResults = Math.max(0, toolResults.length - recentToolResults.length);

          const continuationMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
            {
              role: "system" as const,
              content: buildVoyageSystemPrompt(toolListForPrompt)
            },
            // Include earlier conversation turns so the model retains user preferences
            // (trip duration, transport, pace, interests) from prior messages.
            ...historyPrefix.map(msg => ({
              role: msg.role as "system" | "user" | "assistant",
              content: msg.content
            })),
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
                continuationRuntimeContext,
                continuationRuntimeContext ? "---" : "",
                omittedToolResults > 0
                  ? `Recent tool results (last ${recentToolResults.length} of ${toolResults.length}; ${omittedToolResults} older result(s) omitted — see current itinerary draft state below for cumulative truth):`
                  : "Tool results so far (most recent last):",
                stringifyToolResults(recentToolResults),
                "",
                activeItineraryContext
                  ? `Current itinerary draft state:\n${JSON.stringify(activeItineraryContext.itinerary)}`
                  : "",
                "",
                itineraryIsEmptySkeleton
                  ? `STATE CHECK: The itinerary has ${currentDayCount} day(s) but ZERO items so far. The plan is NOT complete. Your next response MUST be a single add_itinerary_item tool call (or estimate_route to validate the route before the next add). Do NOT respond with plain text yet. Do NOT call plan_itinerary again — the skeleton already exists. Begin populating Day 1.`
                  : isEditLooping()
                    ? "EDIT LOOP DETECTED: You have modified the same items too many times without converging. Your edits are cascading. STOP making further adjustments — minor time gaps or imperfect ordering are acceptable. Respond NOW with a brief plain-text summary of the changes you made. Do NOT make any more tool calls."
                    : isEditCascading()
                      ? "CAUTION: You are re-editing items you already modified. If you have completed the user's requested changes, stop now and respond with a plain-text summary. Only continue if there are still unfinished additions or edits the user explicitly asked for. Do not keep adjusting times across the whole day — small gaps are acceptable."
                      : "If the itinerary still needs more stops or changes to fulfil the original request, respond with the next single tool call. When the requested changes are complete, respond with a brief plain-text summary and no tool call. Do not cascade time adjustments across the entire day — only adjust items that directly overlap. Small gaps between items are fine."
              ].filter(Boolean).join("\n")
            }
          ];

          let nextContent: string;
          let nextUsage: ModelUsage | undefined;
          try {
            const completion = await options.modelProvider.complete({
              messages: continuationMessages,
              temperature: 0.6
            });
            nextContent = completion.content;
            nextUsage = completion.usage;
            agentLogger.modelOutput(input.runId, nextContent, nextUsage);
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

          // If we already warned the agent about an edit loop but it still issued a tool call,
          // force-break the loop to prevent runaway cost and latency.
          if (isEditLooping()) {
            agentLogger.debug(input.runId, "Force-breaking continuation loop: edit loop detected after warning");
            shouldContinueLoop = false;
            break;
          }

          try {
            await executeToolCallsBatch(nextParsed.toolCalls);
          } catch (error) {
            if (signal?.aborted) { agentLogger.debug(input.runId, "Run cancelled by user"); return; }
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
        let synthesisUsage: ModelUsage | undefined;
        let streamedSynthesis = false;
        try {
          const synthesisToolResults = toolResults.slice(-SYNTHESIS_TOOL_RESULTS_TAIL);
          const synthesisOmittedCount = Math.max(0, toolResults.length - synthesisToolResults.length);
          const finalItineraryJson = activeItineraryContext
            ? JSON.stringify(activeItineraryContext.itinerary)
            : "";

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
              content: [
                finalItineraryJson
                  ? `Final itinerary draft state (cumulative truth — summarize this, do not echo it):\n${finalItineraryJson}`
                  : "",
                synthesisOmittedCount > 0
                  ? `Recent tool results JSON (last ${synthesisToolResults.length} of ${toolResults.length}; ${synthesisOmittedCount} older itinerary-streaming result(s) omitted because the cumulative state is above):`
                  : "Tool results JSON:",
                stringifyToolResults(synthesisToolResults)
              ].filter(Boolean).join("\n\n")
            }
          ];

          if (options.modelProvider.completeStream) {
            const streamed = await streamModelCompletion({
              modelProvider: options.modelProvider,
              input: {
                messages: synthesisMessages,
                temperature: 0.6
              },
              onDelta: async (delta) => {
                await options.agentService.recordRunEvent(run, {
                  type: "message.delta",
                  payload: { delta }
                });
              }
            });

            if (streamed && streamed.content.trim().length > 0) {
              synthesizedMessage = recoverSynthesizedMessage(
                streamed.content.trim(),
                toolResults,
                parsedOutput.assistantMessage
              );
              synthesisUsage = streamed.usage;
              streamedSynthesis = true;
            }
          }

          if (!streamedSynthesis) {
            const synthesis = await options.modelProvider.complete({
              messages: synthesisMessages,
              temperature: 0.6
            });
            synthesisUsage = synthesis.usage;
            synthesizedMessage = recoverSynthesizedMessage(
              synthesis.content.trim() || parsedOutput.assistantMessage,
              toolResults,
              parsedOutput.assistantMessage
            );
          }

          agentLogger.synthesisOutput(input.runId, synthesizedMessage, synthesisUsage);
        } catch {
          synthesizedMessage = parsedOutput.assistantMessage;
          agentLogger.error("Synthesis Failed", input.runId, "Falling back to assistant message.");
        }

        if (!streamedSynthesis) {
          await options.agentService.recordRunEvent(run, {
            type: "message.delta",
            payload: { delta: synthesizedMessage }
          });
        }
        // Enrich PlaceSnapshots (photos, ratings) BEFORE completing the run
        // so the client's post-completion re-fetch gets fully populated data.
        if (activeItineraryContext?.itinerary && options.onBeforeRunComplete) {
          try { await options.onBeforeRunComplete(activeItineraryContext.itinerary); } catch { /* best-effort */ }
        }

        await options.agentService.completeRun(run.id, synthesizedMessage);

      } catch (error) {
        if (signal?.aborted) { agentLogger.debug(input.runId, "Run cancelled by user"); return; }
        await failRun(input, error);
      } finally {
        options.toolRegistry.clearRun?.(input.runId);
      }
    }
  };
}
