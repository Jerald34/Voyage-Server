import { z } from "zod";
import { ApiError } from "../../http/errors";
import type { ModelProvider } from "../../services/modelProvider";
import { structuredItineraryInputSchema } from "../itineraries/itinerarySchemas";
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
  getThread(
    agencyId: string,
    threadId: string
  ): Promise<{ messages: Array<{ role: "USER" | "ASSISTANT" | "SYSTEM_VISIBLE"; content: string }> }>;
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

type ParsedModelOutput =
  | {
      type: "text";
      assistantMessage: string;
    }
  | {
      type: "json";
      assistantMessage: string;
      toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
    };

function splitTopLevelPairs(text: string) {
  const pairs: string[] = [];
  let current = "";
  let depthCurly = 0;
  let depthSquare = 0;
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : "";
    if ((ch === '"' || ch === "'") && prev !== "\\") {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = ch;
      } else if (quoteChar === ch) {
        inQuotes = false;
        quoteChar = "";
      }
    } else if (!inQuotes) {
      if (ch === "{") depthCurly += 1;
      if (ch === "}") depthCurly -= 1;
      if (ch === "[") depthSquare += 1;
      if (ch === "]") depthSquare -= 1;
    }

    if (ch === "," && !inQuotes && depthCurly === 0 && depthSquare === 0) {
      if (current.trim()) {
        pairs.push(current.trim());
      }
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    pairs.push(current.trim());
  }

  return pairs;
}

function parseLooseObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  const payload = trimmed.slice(1, -1).trim();
  if (!payload) {
    return {};
  }

  const result: Record<string, unknown> = {};
  const pairs = splitTopLevelPairs(payload);
  for (const pair of pairs) {
    const colonIndex = pair.indexOf(":");
    if (colonIndex < 0) {
      continue;
    }
    const rawKey = pair.slice(0, colonIndex);
    const value = pair.slice(colonIndex + 1).trim();
    const key = rawKey.trim().replace(/^['"]|['"]$/g, "");
    if (!key) {
      continue;
    }
    result[key] = parseLooseValue(value);
  }
  return result;
}

function parseLooseValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }
  if (trimmed === "null") {
    return null;
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      if (trimmed.startsWith("{")) {
        const looseObject = parseLooseObject(trimmed);
        if (looseObject) {
          return looseObject;
        }
      }
      return trimmed;
    }
  }
  return trimmed;
}

function canonicalToolName(name: string) {
  const normalized = name.trim().toLowerCase().replace(/[\s\-]+/g, "_");
  const aliases: Record<string, string> = {
    createitinerary: "create_itinerary",
    updateitinerary: "update_itinerary",
    recordagenttask: "record_agent_task",
    websearch: "web_search",
    searchgoogleplaces: "search_google_places",
    getgoogleplacedetails: "get_google_place_details",
    estimateroute: "estimate_route"
  };
  return aliases[normalized] ?? normalized;
}

function isLikelyJson(content: string) {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("<|toolcall|>");
}

function parseToolCallTagOutput(content: string): ParsedModelOutput | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("<|toolcall|>")) {
    return null;
  }
  const callPrefixMatch = trimmed.match(/^<\|toolcall\|>\s*call:([a-zA-Z0-9_]+)/);
  if (!callPrefixMatch) {
    return null;
  }

  const toolName = canonicalToolName(callPrefixMatch[1]);
  const toolNameEnd = callPrefixMatch[0].length;
  const objectStart = trimmed.indexOf("{", toolNameEnd);
  const tailMarker = "<tool_call|>";
  const tailIndex = trimmed.lastIndexOf(tailMarker);
  if (objectStart < 0 || tailIndex < 0 || tailIndex <= objectStart) {
    return null;
  }

  const objectText = trimmed.slice(objectStart, tailIndex).trim();
  if (!objectText.startsWith("{") || !objectText.endsWith("}")) {
    return null;
  }

  let braceDepth = 0;
  for (const ch of objectText) {
    if (ch === "{") braceDepth += 1;
    if (ch === "}") braceDepth -= 1;
    if (braceDepth < 0) {
      return null;
    }
  }
  if (braceDepth !== 0) {
    return null;
  }

  const parsedInput = parseLooseObject(objectText) ?? {};
  const unwrappedInput =
    "input" in parsedInput && typeof parsedInput.input === "object" && parsedInput.input !== null
      ? (parsedInput.input as Record<string, unknown>)
      : parsedInput;

  return {
    type: "json",
    assistantMessage: "Working on that now.",
    toolCalls: [{ name: toolName, input: unwrappedInput }]
  };
}

function parseModelOutput(content: string): ParsedModelOutput {
  const taggedToolCall = parseToolCallTagOutput(content);
  if (taggedToolCall) {
    return taggedToolCall;
  }

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

function availableToolSet(toolNames: string[]) {
  return new Set(toolNames.map((name) => canonicalToolName(name)));
}

function looksLikeItineraryText(content: string) {
  return /\bitinerary\b/i.test(content) || /\bday\s+\d+\b/i.test(content) || /\b\d{1,2}:\d{2}\s*(AM|PM)\b/i.test(content);
}

function looksLikeTripPlanningRequest(content: string) {
  return /\b(itinerary|trip|travel|tour|plan|draft)\b/i.test(content);
}

function shouldRecoverPlainItinerary(options: {
  tools: Set<string>;
  userContent: string;
  modelContent: string;
}) {
  return (
    options.tools.has("create_itinerary") &&
    looksLikeItineraryText(options.modelContent) &&
    (looksLikeTripPlanningRequest(options.userContent) || looksLikeItineraryText(options.userContent))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStructuredCreateItineraryInput(input: unknown) {
  if (!isRecord(input)) {
    return false;
  }
  return isRecord(input.trip) && isRecord(input.itinerary);
}

function getStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getInputDestination(input: Record<string, unknown>) {
  const shorthandDestination = getStringValue(input.destination) || getStringValue(input.location);
  if (shorthandDestination) {
    return shorthandDestination;
  }

  const trip = isRecord(input.trip) ? input.trip : null;
  if (!trip) {
    return "";
  }

  return getStringValue(trip.destinationSummary) || getStringValue(trip.title).replace(/^\d+[-\s]+day\s+/i, "").replace(/\s+trip$/i, "");
}

function normalizeClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) {
    return value.trim();
  }

  const hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const meridiem = match[3]?.toUpperCase();
  return meridiem ? `${hour}:${minute} ${meridiem}` : `${hour}:${minute}`;
}

function inferTimeRange(userContent: string) {
  const match =
    userContent.match(/\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\b/i) ??
    userContent.match(/\bbetween\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*(?:and|-)\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\b/i) ??
    userContent.match(/\bstart(?:s|ing)?\s+(?:at|in)?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?).*?\bend(?:s|ing)?\s+(?:at|in)?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\b/i);
  if (!match) {
    return null;
  }

  return {
    startTime: normalizeClockTime(match[1]),
    endTime: normalizeClockTime(match[2])
  };
}

function inferDurationDays(userContent: string) {
  if (/\b(one|single)[-\s]+day\b/i.test(userContent)) {
    return 1;
  }

  const dayCount = userContent.match(/\b(\d{1,2})[-\s]+day\b/i);
  if (dayCount) {
    return Number(dayCount[1]);
  }

  return null;
}

function inferDestinationFromUserContent(userContent: string) {
  const patterns = [
    /\b(?:for|in|to)\s+([A-Z][a-zA-Z\s.'-]{2,80}?)(?:\s+(?:and|this|that|from|between|located|with|has|is|will|for)\b|[,.]|$)/,
    /\b([A-Z][a-zA-Z\s.'-]{2,80}?)\s+(?:itinerary|trip|tour|travel plan)\b/i
  ];

  for (const pattern of patterns) {
    const match = userContent.match(pattern);
    const destination = match?.[1]?.trim();
    if (destination) {
      return destination.replace(/\s+(?:Philippines|the Philippines)$/i, "").trim();
    }
  }

  return "";
}

function isPlaceholderCreateItineraryInput(input: Record<string, unknown>, userContent: string) {
  if (!isStructuredCreateItineraryInput(input)) {
    return true;
  }

  const requestedDurationDays = inferDurationDays(userContent);
  const itinerary = input.itinerary as Record<string, unknown>;
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  if (requestedDurationDays && days.length !== requestedDurationDays) {
    return true;
  }

  const items = days.flatMap((day) => (isRecord(day) && Array.isArray(day.items) ? day.items : []));
  if (items.length === 0) {
    return true;
  }

  return items.some((item) => {
    if (!isRecord(item)) {
      return true;
    }
    const title = getStringValue(item.title);
    const description = getStringValue(item.description);
    return /\b(placeholder|suggested highlight|planned stop|day\s+\d+\s+plan)\b/i.test(`${title} ${description}`);
  });
}

function inferCreateItineraryInputFromRequest(input: Record<string, unknown>, userContent: string) {
  const destination = getInputDestination(input) || inferDestinationFromUserContent(userContent);
  const requestedDurationDays = inferDurationDays(userContent);
  const durationDays = requestedDurationDays ?? (typeof input.duration_days === "number" ? input.duration_days : 1);
  const timeRange = inferTimeRange(userContent);
  const wantsNature = /\b(nature|park|forest|beach|hiking|outdoor|scenic)\b/i.test(userContent);
  const wantsRestaurant = /\b(restaurant|dining|meal|lunch|food|cafe)\b/i.test(userContent);

  if (!destination) {
    return input;
  }

  const activityTitle = wantsNature ? `${destination} nature experience` : `${destination} destination experience`;
  const mealTitle = wantsRestaurant ? `${destination} restaurant stop` : `${destination} meal break`;
  const wrapTitle = wantsNature ? `${destination} scenic wind-down` : `${destination} afternoon activity`;
  const dayCount = Math.max(1, Math.min(durationDays, 60));
  const days = Array.from({ length: dayCount }, (_, index) => {
    const dayNumber = index + 1;
    const isFirstDay = dayNumber === 1;
    const isLastDay = dayNumber === dayCount;

    return {
      dayNumber,
      title:
        dayCount === 1
          ? wantsNature && wantsRestaurant
            ? "Nature And Dining"
            : `${destination} Day Plan`
          : `Day ${dayNumber} In ${destination}`,
      items: [
        {
          type: "ACTIVITY" as const,
          title: dayCount === 1 ? activityTitle : `${destination} Day ${dayNumber} highlight`,
          description:
            dayCount === 1
              ? `Start with a focused ${wantsNature ? "nature" : "destination"} stop in ${destination}.`
              : `Plan a concrete activity in ${destination} that matches the agency request for Day ${dayNumber}.`,
          ...(timeRange && isFirstDay ? { startTime: timeRange.startTime } : {})
        },
        {
          type: "MEAL" as const,
          title: dayCount === 1 ? mealTitle : `${destination} Day ${dayNumber} meal stop`,
          description: `Plan a restaurant or dining break in ${destination}.`
        },
        {
          type: "ACTIVITY" as const,
          title: dayCount === 1 ? wrapTitle : `${destination} Day ${dayNumber} wrap-up`,
          description: `Close the day with a nearby activity that keeps the itinerary aligned with the requested pace.`,
          ...(timeRange && isLastDay ? { endTime: timeRange.endTime } : {})
        }
      ]
    };
  });

  return {
    trip: {
      title: `${dayCount}-Day ${destination} Trip`,
      destinationSummary: destination,
      travelerCount: input.traveler_count,
      budgetLevel: input.budget_level
    },
    itinerary: {
      title: `${dayCount}-Day ${destination} Itinerary`,
      summary: `A ${dayCount}-day itinerary in ${destination} based on the requested timing and themes.`,
      days
    }
  };
}

function enrichToolInputFromUserRequest(toolName: string, input: Record<string, unknown>, userContent: string) {
  if (canonicalToolName(toolName) !== "create_itinerary" || !isPlaceholderCreateItineraryInput(input, userContent)) {
    return input;
  }

  return inferCreateItineraryInputFromRequest(input, userContent);
}

async function customizeCreateItineraryInput(options: {
  modelProvider: ModelProvider;
  input: Record<string, unknown>;
  userContent: string;
}) {
  try {
    const completion = await options.modelProvider.complete({
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            [
              "Convert the agency staff request into one fully customized create_itinerary input.",
              "Return ONLY strict JSON with this exact top-level shape:",
              '{"trip":{"title":"string","destinationSummary":"string","clientName":"string optional","startDate":"date optional","endDate":"date optional","travelerCount":1,"budgetLevel":"string optional"},"itinerary":{"title":"string","summary":"string","days":[{"dayNumber":1,"title":"string","summary":"string optional","items":[{"type":"ACTIVITY","title":"string","description":"string","startTime":"string optional","endTime":"string optional","staffNotes":"string optional","clientNotes":"string optional"}]}]}}',
              "Allowed item types: ACTIVITY, MEAL, TRANSFER, CHECK_IN, CHECK_OUT, FREE_TIME, NOTE.",
              "Preserve every explicit user constraint: destination, dates, day count, start/end times, pace, budget, traveler count, interests, meals, accessibility, exclusions, must-see places, and special requests.",
              "The original user request overrides conflicting weak tool input values such as default duration_days.",
              "Do not invent live availability, prices, ratings, named sources, or map distances.",
              "If exact places are not provided, create useful item titles that reflect the requested category and destination instead of leaving items empty.",
              "Never return empty days, generic placeholder days, or placeholder item titles."
            ].join(" ")
        },
        {
          role: "user",
          content: `Original user request:\n${options.userContent}`
        },
        {
          role: "assistant",
          content: `Weak create_itinerary input proposed by model:\n${JSON.stringify(options.input)}`
        }
      ]
    });

    const parsedJson = JSON.parse(completion.content);
    const candidate =
      isRecord(parsedJson) && isRecord(parsedJson.input)
        ? parsedJson.input
        : parsedJson;
    const parsed = structuredItineraryInputSchema.safeParse(candidate);
    if (parsed.success && !isPlaceholderCreateItineraryInput(parsed.data as unknown as Record<string, unknown>, options.userContent)) {
      return parsed.data;
    }
  } catch {
    // Fall back to deterministic request inference when model conversion fails.
  }

  return enrichToolInputFromUserRequest("create_itinerary", options.input, options.userContent);
}

async function enrichToolInputFromUserRequestForExecution(options: {
  modelProvider: ModelProvider;
  toolName: string;
  input: Record<string, unknown>;
  userContent: string;
}) {
  if (canonicalToolName(options.toolName) !== "create_itinerary" || !isPlaceholderCreateItineraryInput(options.input, options.userContent)) {
    return options.input;
  }

  return customizeCreateItineraryInput({
    modelProvider: options.modelProvider,
    input: options.input,
    userContent: options.userContent
  });
}

function shouldCreateItineraryDirectlyFromUserRequest(options: {
  tools: Set<string>;
  userContent: string;
}) {
  return (
    options.tools.has("create_itinerary") &&
    /\b(create|make|build|draft|generate|prepare)\b/i.test(options.userContent) &&
    (looksLikeTripPlanningRequest(options.userContent) || looksLikeItineraryText(options.userContent))
  );
}

function createItineraryToolCallFromUserRequest(userContent: string): ParsedModelOutput | null {
  const input = inferCreateItineraryInputFromRequest({}, userContent);
  const parsed = structuredItineraryInputSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }

  return {
    type: "json",
    assistantMessage: "I will create a customized itinerary draft from your request.",
    toolCalls: [
      {
        name: "create_itinerary",
        input: parsed.data as unknown as Record<string, unknown>
      }
    ]
  };
}

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
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("<|toolcall|>")
    ? ("json" as const)
    : ("text" as const);
}

async function recoverPlainItineraryToolOutput(options: {
  modelProvider: ModelProvider;
  userContent: string;
  assistantContent: string;
}) {
  const recovery = await options.modelProvider.complete({
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          [
            "Convert the assistant itinerary prose into a create_itinerary tool call.",
            "Return ONLY strict JSON with this exact shape:",
            '{"assistantMessage":"string","toolCalls":[{"name":"create_itinerary","input":{"trip":{"title":"string","destinationSummary":"string"},"itinerary":{"title":"string","summary":"string","days":[{"dayNumber":1,"title":"string","items":[{"type":"ACTIVITY","title":"string","description":"string","startTime":"string","endTime":"string"}]}]}}}]}',
            "Use only these item types: ACTIVITY, MEAL, TRANSFER, CHECK_IN, CHECK_OUT, FREE_TIME, NOTE.",
            "Preserve concrete times, locations, meals, activities, and day structure from the prose.",
            "Do not add web-search claims or external-source claims."
          ].join(" ")
      },
      {
        role: "user",
        content: `Original user request:\n${options.userContent}`
      },
      {
        role: "assistant",
        content: options.assistantContent
      }
    ]
  });

  const parsed = parseModelOutput(recovery.content);
  return parsed.type === "json" && parsed.toolCalls.length > 0 ? parsed : null;
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

      let conversationHistory: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
      try {
        const thread = await options.agentService.getThread(input.agencyId, input.threadId);
        const recentMessages = thread.messages.slice(-historyMessageLimit);
        conversationHistory = recentMessages
          .map((message) => {
            if (message.role === "USER") {
              return { role: "user" as const, content: message.content };
            }
            if (message.role === "ASSISTANT") {
              return { role: "assistant" as const, content: message.content };
            }
            return { role: "system" as const, content: message.content };
          })
          .filter((message) => message.content.trim().length > 0);
      } catch {
        // If history lookup fails, continue with the current message only.
      }

      let modelContent = "";
      let initialMode: "text" | "json" = "text";
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
            content:
              [
                "You are an agency itinerary planning assistant.",
                `Available tools: ${toolListForPrompt}.`,
                "When tools are needed, return ONLY strict JSON with this shape:",
                '{"assistantMessage":"string","toolCalls":[{"name":"tool_name","input":{"key":"value"}}]}',
                "Do not output XML-like tags such as <|toolcall|> or <tool_call|>.",
                "Never invent tool names not in the available tools list.",
                "Do not claim that you searched the web, checked live prices, or reviewed external sources unless you actually include a matching tool call.",
                "For trip planning requests, call create_itinerary (or update_itinerary if revising an existing draft) before writing a final narrative.",
                "When calling create_itinerary, prefer a full structured input with trip.title, trip.destinationSummary, itinerary.title, itinerary.summary, and itinerary.days[].items[].",
                "Preserve user constraints such as day count, start/end times, dates, budget, pace, traveler count, meals, must-see interests, accessibility needs, exclusions, and special requests.",
                "Do not send destination-only create_itinerary input for a customized planning request.",
                "Use snake_case tool names exactly as listed in Available tools."
              ].join(" ")
          },
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
              if (
                initialMode === "text" &&
                !shouldRecoverPlainItinerary({
                  tools,
                  userContent: input.userContent,
                  modelContent
                })
              ) {
                await options.agentService.recordRunEvent(run, {
                  type: "message.delta",
                  payload: { delta }
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
      } catch (error) {
        await failRun(input, error);
        return;
      }

      let parsedOutput: ReturnType<typeof parseModelOutput> | null = null;
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

        if (!parsedOutput) {
          await streamAndComplete(run, modelContent);
          return;
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
        const persistedToolCall = await options.agentService.recordToolCallStarted(
          run,
          { toolName: toolCall.name, input: toolInput },
          startedAt
        );
        await options.agentService.recordRunEvent(run, {
          type: "tool.started",
          payload: { name: toolCall.name, input: toolInput }
        });
        toolCallsExecuted += 1;

        try {
          const output = await options.toolRegistry.execute(toolCall.name, context, toolInput);
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

          // Degrade gracefully when web search provider is unavailable instead of failing the whole run.
          if (toolCall.name === "web_search" && details.code === "WEB_SEARCH_PROVIDER_UNAVAILABLE") {
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
            content:
              [
                "You are an agency itinerary planning assistant.",
                "Write the final assistant response for agency staff using ONLY the provided tool results.",
                "Prioritize concrete create_itinerary or update_itinerary outcomes, including itinerary titles, days, item titles, and start/end times when available.",
                "If create_itinerary or update_itinerary succeeded, clearly state that the itinerary draft was created or updated.",
                "Do not say you cannot provide a detailed itinerary when itinerary tool results include itinerary days or items; missing web_search evidence is only a caveat, not a blocker.",
                "If web_search results are missing, unavailable, or empty, explicitly avoid claims like 'based on web search results' and instead state that live web evidence was unavailable.",
                "Do not fabricate named sources, pages, routes, prices, schedules, or provider findings.",
                "Return plain assistant text only."
              ].join(" ")
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

        if (options.modelProvider.completeStream) {
          synthesizedMessage = "";
          const streamed = await streamModelCompletion({
            modelProvider: options.modelProvider,
            input: {
              messages: synthesisMessages,
              temperature: 0.2
            },
            onDelta: async (delta) => {
              await options.agentService.recordRunEvent(run, {
                type: "message.delta",
                payload: { delta }
              });
            }
          });

          if (typeof streamed === "string") {
            synthesizedMessage = streamed.trim() || parsedOutput.assistantMessage;
          }
        } else {
          const synthesis = await options.modelProvider.complete({
            messages: synthesisMessages,
            temperature: 0.2
          });
          synthesizedMessage = synthesis.content.trim() || parsedOutput.assistantMessage;
        }
      } catch {
        synthesizedMessage = parsedOutput.assistantMessage;
      }

      if (!options.modelProvider.completeStream) {
        await options.agentService.recordRunEvent(run, {
          type: "message.delta",
          payload: { delta: synthesizedMessage }
        });
      }
      await options.agentService.completeRun(run.id, synthesizedMessage);
    }
  };
}
