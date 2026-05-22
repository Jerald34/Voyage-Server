import { replaceItinerarySchema, structuredItineraryInputSchema } from "../itineraries/itinerarySchemas";
import type { ModelProvider } from "../../services/modelProvider";
import { canonicalToolName, type ParsedModelOutput, parseModelOutput } from "./agentParser";
import {
  isStructuredCreateItineraryInput,
  getStringValue,
  inferDurationDays,
  looksLikeDetailedScheduleRequest,
  inferCreateItineraryInputFromRequest
} from "./agentHeuristics";

export function isPlaceholderCreateItineraryInput(input: Record<string, unknown>, userContent: string) {
  if (!isStructuredCreateItineraryInput(input)) {
    return isWeakCreateItineraryShorthand(input, userContent);
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

export function enrichToolInputFromUserRequest(toolName: string, input: Record<string, unknown>, userContent: string) {
  if (canonicalToolName(toolName) !== "create_itinerary" || !isPlaceholderCreateItineraryInput(input, userContent)) {
    return input;
  }

  return inferCreateItineraryInputFromRequest(input, userContent);
}

export async function customizeCreateItineraryInput(options: {
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
              '{"trip":{"title":"string","destinationSummary":"string","clientName":"string optional","startDate":"date optional","endDate":"date optional","travelerCount":1,"budgetLevel":"string optional"},"itinerary":{"title":"string","summary":"string","days":[{"dayNumber":1,"title":"string","summary":"string optional","items":[{"type":"ACTIVITY","title":"string","description":"string","startTime":"string optional","endTime":"string optional","placeName":"string optional","cityContext":"string optional","staffNotes":"string optional","clientNotes":"string optional"}]}]}}',
              "Preserve every explicit user constraint: destination, dates, day count, start/end times, pace, budget, traveler count, interests, meals, accessibility, exclusions, must-see places, and special requests.",
              "The original user request overrides conflicting weak tool input values such as default duration_days.",
              "A day is a time box, not one location. If a daily start/end window is present, fill that window with multiple timed items that fit the request.",
              "For a proper itinerary, create at least three items per day when the time window allows: morning/first activity, meal/resto/cafe when requested or sensible, and afternoon/evening activity.",
              "If the user asks for restaurants, resto, food, cafes, or dining, include at least one MEAL item per active day.",
              "Split compound stops into separate items when they are separate places, each with its own placeName and cityContext.",
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

export async function enrichToolInputFromUserRequestForExecution(options: {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getDayNumber(value: unknown) {
  return isRecord(value) && typeof value.dayNumber === "number" ? value.dayNumber : null;
}

function mergeObjectRecord(base: Record<string, unknown>, incoming: Record<string, unknown>) {
  return {
    ...base,
    ...incoming
  };
}

function mergeItineraryDay(baseDay: Record<string, unknown>, incomingDay: Record<string, unknown>) {
  const baseItems = Array.isArray(baseDay.items) ? baseDay.items.filter(isRecord) : [];
  const incomingItems = Array.isArray(incomingDay.items) ? incomingDay.items.filter(isRecord) : [];
  const mergedItems = baseItems.map((baseItem, index) => {
    const incomingItem = incomingItems[index];
    return incomingItem ? mergeObjectRecord(baseItem, incomingItem) : baseItem;
  });

  for (let index = baseItems.length; index < incomingItems.length; index += 1) {
    mergedItems.push(incomingItems[index]);
  }

  return {
    ...baseDay,
    ...incomingDay,
    items: mergedItems
  };
}

function mergeReplacementItinerary(baseItinerary: Record<string, unknown>, incomingItinerary: Record<string, unknown>) {
  const baseDays = Array.isArray(baseItinerary.days) ? baseItinerary.days.filter(isRecord) : [];
  const incomingDays = Array.isArray(incomingItinerary.days) ? incomingItinerary.days.filter(isRecord) : [];
  const mergedDays = baseDays.map((baseDay) => {
    const dayNumber = getDayNumber(baseDay);
    const incomingDay = dayNumber === null ? null : incomingDays.find((day) => getDayNumber(day) === dayNumber);
    return incomingDay ? mergeItineraryDay(baseDay, incomingDay) : baseDay;
  });

  for (const incomingDay of incomingDays) {
    const dayNumber = getDayNumber(incomingDay);
    if (dayNumber === null) {
      mergedDays.push(incomingDay);
      continue;
    }
    if (!mergedDays.some((day) => (day as any).dayNumber === dayNumber)) {
      mergedDays.push(incomingDay);
    }
  }

  return {
    ...baseItinerary,
    ...incomingItinerary,
    days: mergedDays.sort((a, b) => {
      const left = typeof (a as any).dayNumber === "number" ? (a as any).dayNumber : Number.MAX_SAFE_INTEGER;
      const right = typeof (b as any).dayNumber === "number" ? (b as any).dayNumber : Number.MAX_SAFE_INTEGER;
      return left - right;
    })
  };
}

export function mergeUpdateItineraryInputFromActiveItinerary(options: {
  input: Record<string, unknown>;
  activeItinerary: unknown;
}) {
  if (!isRecord(options.input) || !isRecord(options.activeItinerary)) {
    return options.input;
  }

  const activeItineraryResult = replaceItinerarySchema.safeParse(options.activeItinerary);
  if (!activeItineraryResult.success) {
    return options.input;
  }

  const itineraryId = typeof options.input.itineraryId === "string" ? options.input.itineraryId.trim() : "";
  const activeItineraryId = typeof options.activeItinerary.id === "string" ? options.activeItinerary.id.trim() : "";
  if (itineraryId && activeItineraryId && itineraryId !== activeItineraryId) {
    return options.input;
  }

  const nestedItinerary = isRecord(options.input.itinerary) ? options.input.itinerary : null;
  const flatItinerary =
    Array.isArray(options.input.days) || typeof options.input.title === "string"
      ? Object.fromEntries(
        Object.entries(options.input).filter(([key]) => key !== "itineraryId" && key !== "trip")
      )
      : null;
  const incomingItinerary = nestedItinerary ?? flatItinerary;
  if (!isRecord(incomingItinerary)) {
    return options.input;
  }

  const merged = mergeReplacementItinerary(activeItineraryResult.data as Record<string, unknown>, incomingItinerary);
  const parsed = replaceItinerarySchema.safeParse(merged);
  if (!parsed.success) {
    return options.input;
  }

  return {
    itineraryId: itineraryId || activeItineraryId,
    itinerary: parsed.data
  };
}

export async function recoverPlainItineraryToolOutput(options: {
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

function isWeakCreateItineraryShorthand(input: Record<string, unknown>, userContent = "") {
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

  if (hasAdditionalSignals && looksLikeDetailedScheduleRequest(userContent)) {
    return true;
  }

  return !hasAdditionalSignals;
}
