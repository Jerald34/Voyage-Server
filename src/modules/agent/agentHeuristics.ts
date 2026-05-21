import { structuredItineraryInputSchema } from "../itineraries/itinerarySchemas";
import type { ParsedModelOutput } from "./agentParser";

export function looksLikeItineraryText(content: string) {
  return /\bitinerary\b/i.test(content) || /\bday\s+\d+\b/i.test(content) || /\b\d{1,2}:\d{2}\s*(AM|PM)\b/i.test(content);
}

export function looksLikeTripPlanningRequest(content: string) {
  return /\b(itinerary|trip|travel|tour|plan|draft)\b/i.test(content);
}

/**
 * Stricter check for model output — requires actual itinerary structure patterns
 * (day numbers or clock times), not just the keyword "itinerary".
 * Prevents false positives on conversational responses like
 * "Before I draft the itinerary, let me ask a few questions..."
 */
function looksLikeActualItineraryOutput(content: string) {
  return /\bday\s+\d+\b/i.test(content) || /\b\d{1,2}:\d{2}\s*(AM|PM)\b/i.test(content);
}

export function shouldRecoverPlainItinerary(options: {
  tools: Set<string>;
  userContent: string;
  modelContent: string;
}) {
  return (
    options.tools.has("create_itinerary") &&
    looksLikeActualItineraryOutput(options.modelContent) &&
    (looksLikeTripPlanningRequest(options.userContent) || looksLikeItineraryText(options.userContent))
  );
}

export function isStructuredCreateItineraryInput(input: unknown) {
  if (!isRecord(input)) {
    return false;
  }
  return isRecord(input.trip) && isRecord(input.itinerary);
}

export function looksLikeDetailedScheduleRequest(userContent: string) {
  return Boolean(inferTimeRange(userContent)) ||
    /\b(proper|complete|fully|full|detailed|custom|customized|everyday|each day|all the tourist|all tourist|tourist spot|tourist spots)\b/i.test(userContent);
}

export function isWeakCreateItineraryShorthand(input: Record<string, unknown>, userContent = "") {
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

export function getStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function getInputDestination(input: Record<string, unknown>) {
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

export function normalizeClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) {
    return value.trim();
  }

  const hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const meridiem = match[3]?.toUpperCase();
  return meridiem ? `${hour}:${minute} ${meridiem}` : `${hour}:${minute}`;
}

export function inferTimeRange(userContent: string) {
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

export function inferDurationDays(userContent: string) {
  if (/\b(one|single)[-\s]+day\b/i.test(userContent)) {
    return 1;
  }

  const dayCount = userContent.match(/\b(\d{1,2})[-\s]+day\b/i);
  if (dayCount) {
    return Number(dayCount[1]);
  }

  return null;
}

function parseClockTimeToMinutes(value: string) {
  const normalized = normalizeClockTime(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  }
  return hour * 60 + minute;
}

function formatClockTimeFromMinutes(value: number) {
  const minutesInDay = 24 * 60;
  const normalized = ((Math.round(value) % minutesInDay) + minutesInDay) % minutesInDay;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function withDistributedTimes<T extends Record<string, unknown>>(items: T[], timeRange: { startTime: string; endTime: string } | null) {
  if (!timeRange || items.length === 0) {
    return items;
  }

  const start = parseClockTimeToMinutes(timeRange.startTime);
  const end = parseClockTimeToMinutes(timeRange.endTime);
  if (start == null || end == null || end <= start) {
    return items;
  }

  const gap = items.length > 1 ? 15 : 0;
  const duration = Math.max(30, Math.floor((end - start - gap * (items.length - 1)) / items.length));
  let cursor = start;
  return items.map((item, index) => {
    const itemEnd = index === items.length - 1 ? end : Math.min(end, cursor + duration);
    const timed = {
      ...item,
      startTime: formatClockTimeFromMinutes(cursor),
      endTime: formatClockTimeFromMinutes(itemEnd)
    };
    cursor = itemEnd + gap;
    return timed;
  });
}

function splitHighlightStops(value: unknown) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\s+(?:and|&|\+|followed by|then)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function inferDestinationFromUserContent(userContent: string) {
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

export function inferCreateItineraryInputFromRequest(input: Record<string, unknown>, userContent: string) {
  const destination = getInputDestination(input) || inferDestinationFromUserContent(userContent);
  const requestedDurationDays = inferDurationDays(userContent);
  const durationDays = requestedDurationDays ?? (typeof input.duration_days === "number" ? input.duration_days : 1);
  const timeRange = inferTimeRange(userContent);
  const wantsNature = /\b(nature|park|forest|beach|hiking|outdoor|scenic)\b/i.test(userContent);
  const wantsRestaurant = /\b(restaurant|resto|dining|meal|lunch|food|cafe)\b/i.test(userContent);
  const wantsDetailedSchedule = looksLikeDetailedScheduleRequest(userContent);
  const highlights = Array.isArray(input.highlights) ? input.highlights : [];
  if (!destination) {
    return input;
  }

  const dayCount = Math.max(1, Math.min(durationDays, 60));
  const days = Array.from({ length: dayCount }, (_, index) => {
    const dayNumber = index + 1;
    const highlightStops = splitHighlightStops(highlights[index]);
    const items: Array<Record<string, unknown>> = [];

    for (const stop of highlightStops) {
      items.push({
        type: "ACTIVITY" as const,
        title: stop,
        description: `Visit ${stop} as part of Day ${dayNumber} in ${destination}.`,
        placeName: stop,
        cityContext: destination
      });
    }

    if (items.length === 0 && (wantsNature || (!wantsNature && !wantsRestaurant))) {
      items.push({
        type: "ACTIVITY" as const,
        title: wantsNature ? `${destination} nature activity` : `${destination} activity`,
        description: wantsNature
          ? `Plan a nature-focused activity in ${destination}.`
          : `Plan an activity in ${destination} based on the agency request.`,
        placeName: destination,
        cityContext: destination
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

    if (wantsDetailedSchedule && items.length < 3) {
      items.push({
        type: "ACTIVITY" as const,
        title: `${destination} scenic stop`,
        description: `Add another stop in ${destination} so the day is fully planned instead of a single-location visit.`,
        placeName: destination,
        cityContext: destination
      });
    }

    if (wantsDetailedSchedule && items.length < 3) {
      items.push({
        type: "ACTIVITY" as const,
        title: `${destination} local experience`,
        description: `Use the remaining time for a local experience that matches the requested trip theme.`,
        placeName: destination,
        cityContext: destination
      });
    }

    return {
      dayNumber,
      title: `Day ${dayNumber} In ${destination}`,
      items: withDistributedTimes(items, timeRange)
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

export function shouldCreateItineraryDirectlyFromUserRequest(options: {
  tools: Set<string>;
  userContent: string;
}) {
  return (
    options.tools.has("create_itinerary") &&
    /\b(create|make|build|draft|generate|prepare)\b/i.test(options.userContent) &&
    (looksLikeTripPlanningRequest(options.userContent) || looksLikeItineraryText(options.userContent))
  );
}

export function createItineraryToolCallFromUserRequest(userContent: string): ParsedModelOutput | null {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
