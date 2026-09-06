import { canonicalToolName } from "./agentParser";

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Output-mode detection
// ---------------------------------------------------------------------------

export function detectInitialOutputMode(content: string) {
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

// ---------------------------------------------------------------------------
// Itinerary tool name sets
// ---------------------------------------------------------------------------

export const ITINERARY_TOOL_NAMES = new Set([
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
export const GRANULAR_ITINERARY_TOOL_NAMES = new Set([
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
export const CONTINUATION_TRIGGER_TOOL_NAMES = new Set([
  "record_agent_task",
  "add_agent_task",
  "update_agent_task",
  "list_agent_tasks",
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

// ---------------------------------------------------------------------------
// Itinerary extraction helpers
// ---------------------------------------------------------------------------

export function extractItineraryFromToolOutput(output: unknown) {
  if (!isRecordLike(output)) {
    return null;
  }

  const itinerary = isRecordLike(output.itinerary) ? output.itinerary : output;
  if (typeof itinerary.id !== "string" || !Array.isArray(itinerary.days)) {
    return null;
  }

  return itinerary;
}

export function buildActiveItineraryContext(thread: unknown) {
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
export function applyToolResultToItineraryContext(
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

// Compact form of an itinerary-mutating tool's output for in-memory accumulation in the
// orchestrator's `toolResults` array. The full itinerary snapshot is large (tens of KB for
// a 30-stop trip) and the model only needs the cumulative state once per turn — the
// orchestrator already injects that via `activeItineraryContext`. Keeping the full snapshot
// in every entry of `toolResults[]` causes O(turns × itinerary-size) memory growth and
// bloats the synthesis prompt's tail.
//
// IMPORTANT: We ONLY compact the granular Approach-B tools (`add_itinerary_item`, etc.) —
// those are the ones invoked dozens of times per run. The one-shot tools `create_itinerary`
// and `update_itinerary` keep their full output because `recoverSynthesizedMessage`
// (agentUtils.ts) reads `output.itinerary.title` / `.days[].items[]` from them to build a
// readable fallback summary when synthesis degenerates into placeholder text. Stripping
// those fields would silently break the fallback.
//
// For the granular tools we replace `output.itinerary` with a tiny `{ id, version,
// dayCount, itemCount }` marker. The tools' delta fields (`dayId`, `itemId`, `item`,
// `routeFromPrevious`, etc.) are preserved — those are precisely the per-turn signal the
// model needs to know what just changed.
//
// The full output is still persisted in the `tool.completed` AgentRunEvent so cross-message
// recovery via `buildActiveItineraryContext` continues to work.
export function makeCompactToolOutput(toolName: string, output: unknown): unknown {
  if (!GRANULAR_ITINERARY_TOOL_NAMES.has(toolName) || !isRecordLike(output)) {
    return output;
  }

  const fullItinerary = output.itinerary;
  if (!isRecordLike(fullItinerary)) {
    return output;
  }

  const { dayCount, itemCount } = countItineraryItems(fullItinerary);
  const summary: Record<string, unknown> = {
    id: typeof fullItinerary.id === "string" ? fullItinerary.id : undefined,
    version: typeof fullItinerary.version === "number" ? fullItinerary.version : undefined,
    status: typeof fullItinerary.status === "string" ? fullItinerary.status : undefined,
    dayCount,
    itemCount,
    _compact: true
  };

  return { ...output, itinerary: summary };
}

// Count items across all days. Used to detect premature termination after plan_itinerary
// (model jumps to plain text before populating any stops).
export function countItineraryItems(itinerary: Record<string, unknown> | undefined | null): { dayCount: number; itemCount: number } {
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
export function buildItineraryIdentifierBlock(itinerary: Record<string, unknown> | undefined | null): string {
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
      const startTime = typeof item.startTime === "string" ? item.startTime : null;
      const endTime = typeof item.endTime === "string" ? item.endTime : null;
      const sortLabel = sortOrder !== null ? `sortOrder ${sortOrder}` : "(unknown order)";
      const timeRange = startTime || endTime
        ? `, time = ${startTime ?? "?"}–${endTime ?? "?"}`
        : "";
      itemLines.push(
        `  - ${label} / ${sortLabel}: itemId = ${itemId}${title ? `, title = ${title}` : ""}${timeRange}`
      );
    }
  }

  if (itemLines.length > 0) {
    lines.push("- Existing items:");
    lines.push(...itemLines);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool set helpers
// ---------------------------------------------------------------------------

export function availableToolSet(toolNames: string[]) {
  return new Set(toolNames.map((name) => canonicalToolName(name)));
}

// ---------------------------------------------------------------------------
// Runtime context injection helpers
// ---------------------------------------------------------------------------

// Variable runtime context (active-itinerary prompt + UUID block) is intentionally folded
// into a user message rather than a system message so that the systemInstruction sent to
// Gemini is byte-identical across turns. Stable systemInstruction is a prerequisite for
// implicit / explicit cachedContent reuse.
export function buildRuntimeContextBlock(
  activeItineraryContext: { prompt: string; itinerary: Record<string, unknown> } | null,
  placeAdvisoryBlock = ""
): string {
  const parts: string[] = [];

  if (activeItineraryContext) {
    parts.push(activeItineraryContext.prompt);
    const idBlock = buildItineraryIdentifierBlock(activeItineraryContext.itinerary);
    if (idBlock) {
      parts.push(idBlock);
    }
  }

  // Advisories belong here even with no active itinerary: a run can be blocked
  // from choosing a place before any itinerary exists. This is user-message
  // content, so the cached system instruction is untouched.
  if (placeAdvisoryBlock) {
    parts.push(placeAdvisoryBlock);
  }

  return parts.join("\n\n");
}

export function buildTaskListBlock(tasks: Array<{ id: string; label: string; status: string }>): string {
  if (tasks.length === 0) return "";
  const lines = ["Open tasks for this thread (resume these before starting new work):"];
  for (const task of tasks) {
    lines.push(`- [${task.status}] id=${task.id} "${task.label}"`);
  }
  return lines.join("\n");
}

export function injectRuntimeContextIntoLastUser(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  runtimeContext: string
) {
  if (!runtimeContext) {
    return messages;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      const next = messages.slice();
      next[i] = {
        ...messages[i],
        content: `${runtimeContext}\n\n---\n\n${messages[i].content}`
      };
      return next;
    }
  }
  return messages;
}
