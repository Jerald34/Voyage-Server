import { z } from "zod";
import { ApiError } from "../../http/errors";
import type { ModelProvider } from "../../services/modelProvider";
import { structuredItineraryInputSchema } from "../itineraries/itinerarySchemas";
import type { AgentRunEventRecord, AgentRunRecord, AgentMessageRecord } from "./agentService";
import { agentLogger } from "./agentLogger";
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
  assistantMessage: z.string().min(1).max(12000).optional(),
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
    estimateroute: "estimate_route",
    mappinpoint: "map_pinpoint",
    routelogistics: "route_logistics",
    placeinsights: "place_insights",
    searchnearbygoogleplaces: "search_nearby_google_places",
    getgoogleplacephotos: "get_google_place_photos",
    map_pinpoint_tool: "map_pinpoint",
    route_logistics_tool: "route_logistics",
    place_insights_tool: "place_insights"
  };
  return aliases[normalized] ?? normalized;
}

function isLikelyJson(content: string) {
  const trimmed = content.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("<|toolcall|>") ||
    trimmed.startsWith("<|tool_call>") ||
    trimmed.startsWith("<tool_call>") ||
    trimmed.startsWith("<tool_call|>") ||
    trimmed.startsWith('"')
  );
}

function parseXmlArgs(argsText: string): Record<string, unknown> {
  const trimmed = argsText.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      throw new ApiError(500, "MODEL_OUTPUT_INVALID", "Tool args must be an object.");
    }
    return parsed;
  }

  const input: Record<string, unknown> = {};
  const fieldRegex = /<([a-zA-Z][a-zA-Z0-9_]*)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(trimmed)) !== null) {
    input[match[1]] = match[2].trim();
  }

  if (Object.keys(input).length === 0) {
    throw new ApiError(500, "MODEL_OUTPUT_INVALID", "Tool args were not valid JSON or XML fields.");
  }
  return input;
}

function parseXmlToolCallOutput(content: string): ParsedModelOutput | null {
  const match = content.match(/<tool_call>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<args>([\s\S]*?)<\/args>[\s\S]*?<\/tool_call>/i);
  if (!match) {
    return null;
  }

  const assistantMessage = content.slice(0, match.index).trim() || "Working on that now.";
  return {
    type: "json",
    assistantMessage,
    toolCalls: [
      {
        name: canonicalToolName(match[1]),
        input: parseXmlArgs(match[2])
      }
    ]
  };
}

function parseToolCallTagOutput(content: string): ParsedModelOutput | null {
  const trimmed = content.trim();
  const callPrefixMatch = trimmed.match(/<\|?tool_?call\|?>\s*call:([a-zA-Z0-9_]+)/i);
  if (!callPrefixMatch) {
    return null;
  }

  const toolName = canonicalToolName(callPrefixMatch[1]);
  const toolNameEnd = (callPrefixMatch.index ?? 0) + callPrefixMatch[0].length;
  const objectStart = trimmed.indexOf("{", toolNameEnd);
  const tailMatch = trimmed.match(/<\|?tool_?call\|?>/g);
  const lastTail = tailMatch ? tailMatch[tailMatch.length - 1] : null;
  const tailIndex = lastTail ? trimmed.lastIndexOf(lastTail) : -1;
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

  const assistantMessage = trimmed.slice(0, callPrefixMatch.index).trim() || "Working on that now.";

  return {
    type: "json",
    assistantMessage,
    toolCalls: [{ name: toolName, input: unwrappedInput }]
  };
}

function parsePotentiallyStringifiedJson(content: string): unknown {
  const parsed = JSON.parse(content);
  if (typeof parsed !== "string") {
    return parsed;
  }

  const nested = parsed.trim();
  if (
    nested.startsWith("{") ||
    nested.startsWith("[") ||
    nested.startsWith("<|toolcall|>") ||
    nested.startsWith('"')
  ) {
    return parsePotentiallyStringifiedJson(nested);
  }

  return parsed;
}

/**
 * Attempt to extract a JSON object from a markdown code fence.
 * Models sometimes wrap tool calls in ```json ... ``` blocks.
 */
function extractJsonFromCodeFence(content: string): string | null {
  const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

/**
 * Parse a flat JSON tool call where the model outputs something like:
 * { "tool": "map_pinpoint", "placeName": "Baguio", "cityContext": "Philippines" }
 * This extracts the tool name from the "tool" key and treats everything else as input.
 */
function parseFlatToolCallJson(content: string): ParsedModelOutput | null {
  // Try to find a JSON object in the content (might be inside a code fence or inline)
  let jsonText = extractJsonFromCodeFence(content);
  if (!jsonText) {
    // Try to find a bare JSON object in the content
    const braceStart = content.indexOf("{");
    const braceEnd = content.lastIndexOf("}");
    if (braceStart >= 0 && braceEnd > braceStart) {
      jsonText = content.slice(braceStart, braceEnd + 1);
    }
  }
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  // Must have a "tool" or "name" key that resolves to a known tool
  const rawToolName = (obj.tool ?? obj.name ?? obj.toolName ?? obj.tool_name) as string | undefined;
  if (!rawToolName || typeof rawToolName !== "string") return null;

  const toolName = canonicalToolName(rawToolName);

  // Extract tool input: everything except the tool name key
  const toolInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (["tool", "name", "toolName", "tool_name"].includes(key)) continue;
    toolInput[key] = value;
  }

  // Build the assistant message from any text before/after the JSON block
  const jsonStart = content.indexOf(jsonText);
  const textBefore = content.slice(0, jsonStart).replace(/```json\s*/g, "").replace(/```/g, "").trim();
  const textAfter = content.slice(jsonStart + jsonText.length).replace(/```/g, "").trim();
  const assistantMessage = [textBefore, textAfter].filter(Boolean).join("\n\n") || "Working on that now.";

  console.log(`[Agent] Recovered flat JSON tool call: ${toolName}`, { toolInput, assistantMessage });

  return {
    type: "json" as const,
    assistantMessage,
    toolCalls: [{ name: toolName, input: toolInput }]
  };
}

function parseModelOutput(content: string): ParsedModelOutput {
  console.log(`[Agent] Parsing model output (${content.length} chars)`);
  
  const xmlToolCall = parseXmlToolCallOutput(content);
  if (xmlToolCall && xmlToolCall.type === "json") {
    console.log(`[Agent] Detected XML tool call: ${xmlToolCall.toolCalls[0].name}`);
    return xmlToolCall;
  }

  const taggedToolCall = parseToolCallTagOutput(content);
  if (taggedToolCall && taggedToolCall.type === "json") {
    console.log(`[Agent] Detected Tagged tool call: ${taggedToolCall.toolCalls[0].name}`);
    return taggedToolCall;
  }

  // Try flat JSON tool call (e.g. {"tool": "map_pinpoint", "placeName": "Baguio"})
  const flatToolCall = parseFlatToolCallJson(content);
  if (flatToolCall && flatToolCall.type === "json") {
    console.log(`[Agent] Detected Flat JSON tool call: ${flatToolCall.toolCalls[0].name}`);
    return flatToolCall;
  }

  if (!isLikelyJson(content)) {
    console.log(`[Agent] No tool call detected (isLikelyJson = false). Content: ${content.slice(0, 100)}...`);
    return {
      type: "text" as const,
      assistantMessage: content
    };
  }

  try {
    const parsedJson = parsePotentiallyStringifiedJson(content);
    if (typeof parsedJson === "string") {
      return {
        type: "text" as const,
        assistantMessage: parsedJson
      };
    }

    const parsed = modelJsonOutputSchema.parse(parsedJson);
    console.log(`[Agent] Detected Standard JSON output with ${parsed.toolCalls.length} tool calls`);
    return {
      type: "json" as const,
      assistantMessage: parsed.assistantMessage ?? "Working on that now.",
      toolCalls: parsed.toolCalls
    };
  } catch (error) {
    console.error(`[Agent] JSON parsing/validation failed`, error);
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

function buildVoyageSystemPrompt(toolListForPrompt: string) {
  return [
    "Role & Identity",
    "You are Voyage, a state-of-the-art, spatial-aware AI Travel Agent. You are not just a text-based assistant; you are a dynamic trip architect integrated with an interactive map and a real-time itinerary builder. Your primary goal is to create seamless, highly optimized, and visually engaging travel plans.",
    "",
    "Core Capabilities & Tool Usage",
    "You have access to a suite of backend tools. You must use these tools to validate your suggestions, build the itinerary, and update the user's visual interface (the map).",
    "",
    "Current tools and their roles:",
    "create_itinerary: create a fully populated itinerary draft from structured trip data.",
    "update_itinerary: update an existing itinerary draft from structured trip data.",
    "record_agent_task: create or update internal agent task tracking items.",
    "search_google_places: search for places with Google Maps.",
    "search_nearby_google_places: find restaurants, attractions, or amenities near a specific location.",
    "get_google_place_details: fetch detailed place information from Google Maps.",
    "get_google_place_photos: retrieve photo URLs for a specific Google Place.",
    "estimate_route: calculate travel distance and duration between coordinates.",
    "map_pinpoint: resolve a place and pin it on the user's map.",
    "route_logistics: resolve two places and draw the route between them.",
    "place_insights: resolve a place and return richer map-backed details.",
    "web_search: search the web for supporting evidence.",
    "",
    "Operational Guidelines (Your Rules)",
    "Spatial Logic First: Never schedule two consecutive activities without calculating the travel time between them using estimate_route or route_logistics. Add realistic buffer times.",
    "Interactive Presentation: When you add an item to the itinerary, immediately use map_pinpoint to drop a pin on the map. When scheduling a transition between two places, use route_logistics to draw the route.",
    "Proactive Updates: If a user says, \"I don't want to go to the museum anymore, let's do lunch,\" you must use update_itinerary to DELETE the museum, UPDATE the schedule, and use map_pinpoint or route_logistics to update the map.",
    "Detail-Oriented: Before suggesting a specific restaurant or monument, use get_google_place_details, place_insights, or search_google_places to ensure it fits the user's vibe and is open on that day/time. Use get_google_place_photos to show the user what they can expect.",
    "Communication Style: Be inspiring, organized, and concise. Refer to the map visually (e.g., \"I've dropped a pin on the map for the Colosseum, and drawn a walking route to your next stop...\").",
    "",
    "Tool Policy",
    "Use only tool names listed in the available tools list.",
    "Call at most one tool per assistant response.",
    "Put the tool call at the very beginning of the response.",
    "Never provide lat, lng, latitude, or longitude unless a tool explicitly requires them.",
    "For map or itinerary places, provide placeName and cityContext.",
    "Do not claim live data, map details, routes, prices, or sources unless a corresponding tool result exists.",
    "When no tool is needed, return plain assistant text only.",
    "",
    "Tool Call Format",
    'To call a tool, output a JSON object at the very start of your message in this exact format:',
    '{"tool": "<tool_name>", ...arguments}',
    'Example: {"tool": "map_pinpoint", "placeName": "Eiffel Tower", "cityContext": "Paris, France"}',
    'Example: {"tool": "search_google_places", "query": "best restaurants in Rome"}',
    'Example: {"tool": "create_itinerary", "destination": "Paris, France", "duration_days": 3, "activity_type": "luxury shopping"}',
    'After the JSON object, include your conversational explanation of what you are doing.',
    'Do NOT wrap the tool call in markdown code fences like ```json```. Output the raw JSON directly.',
    "",
    `Available tools: ${toolListForPrompt}.`
  ].join(" ");
}

function buildVoyageSynthesisPrompt() {
  return [
    "Role & Identity",
    "You are Voyage, a state-of-the-art, spatial-aware AI Travel Agent.",
    "",
    "Response Rules",
    "Write the final assistant response for agency staff using ONLY the provided tool results.",
    "Prioritize concrete create_itinerary or update_itinerary outcomes, including itinerary titles, days, item titles, and start/end times when available.",
    "If create_itinerary or update_itinerary succeeded, clearly state that the itinerary draft was created or updated.",
    "Do not say you cannot provide a detailed itinerary when itinerary tool results include itinerary days or items; missing web_search evidence is only a caveat, not a blocker.",
    "If web_search results are missing, unavailable, or empty, explicitly avoid claims like 'based on web search results' and instead state that live web evidence was unavailable.",
    "Do not fabricate named sources, pages, routes, prices, schedules, or provider findings.",
    "Return plain assistant text only."
  ].join(" ");
}

function isStructuredCreateItineraryInput(input: unknown) {
  if (!isRecord(input)) {
    return false;
  }
  return isRecord(input.trip) && isRecord(input.itinerary);
}

function isWeakCreateItineraryShorthand(input: Record<string, unknown>) {
  const hasDestination = getStringValue(input.destination) || getStringValue(input.location);
  if (!hasDestination) {
    return false;
  }

  const hasAdditionalSignals =
    typeof input.duration_days === "number" ||
    getStringValue(input.activity_type) ||
    (Array.isArray(input.highlights) && input.highlights.length > 0) ||
    typeof input.traveler_count === "number" ||
    getStringValue(input.budget_level);

  return !hasAdditionalSignals;
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
    return isWeakCreateItineraryShorthand(input);
  }

  const requestedDurationDays = inferDurationDays(userContent);
  const itinerary = input.itinerary as Record<string, unknown>;
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  if (requestedDurationDays && days.length !== requestedDurationDays) {
    return true;
  }

  const items = days.flatMap((day) => (isRecord(day) && Array.isArray(day.items) ? day.items : []));
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
  const wantsRestaurant = /\b(restaurant|resto|dining|meal|lunch|food|cafe)\b/i.test(userContent);
  if (!destination) {
    return input;
  }

  const dayCount = Math.max(1, Math.min(durationDays, 60));
  const days = Array.from({ length: dayCount }, (_, index) => {
    const dayNumber = index + 1;
    const items = [];

    if (wantsNature || (!wantsNature && !wantsRestaurant)) {
      items.push({
        type: "ACTIVITY" as const,
        title: wantsNature ? `${destination} nature activity` : `${destination} activity`,
        description: wantsNature
          ? `Plan a nature-focused activity in ${destination}.`
          : `Plan an activity in ${destination} based on the agency request.`,
        placeName: destination,
        cityContext: destination,
        ...(timeRange && dayNumber === 1 ? { startTime: timeRange.startTime } : {})
      });
    }

    if (wantsRestaurant) {
      items.push({
        type: "MEAL" as const,
        title: `${destination} restaurant stop`,
        description: `Plan a restaurant stop in ${destination}.`,
        placeName: destination,
        cityContext: destination
      });
    }

    if (timeRange && items.length > 0 && dayNumber === dayCount) {
      items[items.length - 1] = {
        ...items[items.length - 1],
        endTime: timeRange.endTime
      };
    }

    return {
      dayNumber,
      title: `Day ${dayNumber} In ${destination}`,
      items
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
              "Preserve every explicit user constraint: destination, dates, day count, start/end times, pace, budget, traveler count, interests, meals, accessibility, exclusions, must-see places, and special requests.",
              "The original user request overrides conflicting weak tool input values such as default duration_days.",
              "Do not invent live availability, prices, ratings, named sources, or map distances.",
              "If exact places are not provided, create useful item titles that reflect the requested category and destination instead of leaving items empty.",
              "Never return empty days, generic placeholder days, or placeholder item titles."
            ].join(" ")
        },
        {
          role: "user",
          content: `Original user request:\n${options.userContent}\n\nWeak create_itinerary input proposed by model:\n${JSON.stringify(options.input)}\n\nConvert this into a fully customized create_itinerary input JSON.`
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
  // If it starts with a JSON-like or Tag-like character, it's likely a tool call.
  // We keep it as "text" if it doesn't start with these, but we no longer return early in run()
  // just because it's "text" mode, allowing the parser to find embedded tool calls later.
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
    async run(input) {
      agentLogger.debug(input.runId, `Starting run for thread ${input.threadId}`);
      const run = await options.agentService.startRun(input.runId, now());
      try {

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

          // We used to return early here if (!parsedOutput), but that prevented us from finding
          // tool calls embedded later in the text response. We now fall through to parseModelOutput().
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
            agentLogger.error(`Tool Execution Failed: ${toolCall.name}`, input.runId, error);
            const details = errorDetails(error);
            await options.agentService.failToolCall(persistedToolCall.id, details.code, details.message, now());
            await options.agentService.recordRunEvent(run, {
              type: "tool.failed",
              payload: { name: toolCall.name, code: details.code, message: details.message }
            });

            // Degrade gracefully when external providers are unavailable instead of failing the whole run.
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
          synthesizedMessage = synthesis.content.trim() || parsedOutput.assistantMessage;
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
