import { z } from "zod";
import { ApiError } from "../../http/errors";

export const modelToolCallSchema = z.object({
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({})
});

export const modelJsonOutputSchema = z.object({
  assistantMessage: z.string().min(1).max(12000).optional(),
  toolCalls: z.array(modelToolCallSchema).default([])
});

export type ParsedModelOutput =
  | {
    type: "text";
    assistantMessage: string;
  }
  | {
    type: "json";
    assistantMessage: string;
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  };

export function canonicalToolName(name: string) {
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

export function isLikelyJson(content: string) {
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

export function parseLooseObject(text: string): Record<string, unknown> | null {
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

export function parseLooseValue(value: string): unknown {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function extractJsonFromCodeFence(content: string): string | null {
  const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

function parseFlatToolCallJson(content: string): ParsedModelOutput | null {
  let jsonText = extractJsonFromCodeFence(content);
  if (!jsonText) {
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

  const rawToolName = (obj.tool ?? obj.name ?? obj.toolName ?? obj.tool_name) as string | undefined;
  if (!rawToolName || typeof rawToolName !== "string") return null;

  const toolName = canonicalToolName(rawToolName);

  const toolInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (["tool", "name", "toolName", "tool_name"].includes(key)) continue;
    toolInput[key] = value;
  }

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

export function parseModelOutput(content: string): ParsedModelOutput {
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
