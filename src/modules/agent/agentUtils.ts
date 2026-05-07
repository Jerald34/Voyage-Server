import { ApiError } from "../../http/errors";

export function errorDetails(error: unknown) {
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

export function stringifyToolResults(toolResults: Array<{ name: string; output: unknown }>) {
  // Map large or complex tool results to concise summaries before stringifying.
  // This keeps the synthesis prompt context manageable and prevents truncation
  // from creating invalid JSON.
  const summarizedResults = toolResults.map(result => {
    if (result.name === "create_itinerary" || result.name === "update_itinerary") {
      const summary = getItinerarySummary(result.output);
      if (summary) {
        return { name: result.name, output: { success: true, summary } };
      }
    }
    return result;
  });

  const text = JSON.stringify(summarizedResults);
  if (text.length <= 16000) {
    return text;
  }
  return `${text.slice(0, 15997)}...`;
}


function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyOptional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getItinerarySummary(output: unknown) {
  if (!isRecordLike(output) || !isRecordLike(output.itinerary)) {
    return null;
  }

  const itinerary = output.itinerary;
  const title = stringifyOptional(itinerary.title) ?? "itinerary draft";
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  const lines = [`I created the itinerary draft: ${title}.`];

  for (const day of days) {
    if (!isRecordLike(day)) {
      continue;
    }

    const dayNumber = typeof day.dayNumber === "number" ? `Day ${day.dayNumber}` : stringifyOptional(day.title) ?? "Day";
    const dayTitle = stringifyOptional(day.title);
    lines.push("");
    lines.push(dayTitle && dayTitle !== dayNumber ? `${dayNumber}: ${dayTitle}` : `${dayNumber}`);

    const items = Array.isArray(day.items) ? day.items : [];
    for (const item of items) {
      if (!isRecordLike(item)) {
        continue;
      }

      const itemTitle = stringifyOptional(item.title);
      if (!itemTitle) {
        continue;
      }

      const startTime = stringifyOptional(item.startTime);
      const endTime = stringifyOptional(item.endTime);
      const time = startTime && endTime ? `${startTime}-${endTime}` : startTime ?? endTime;
      const placeSnapshot = isRecordLike(item.placeSnapshot) ? item.placeSnapshot : null;
      const placeName = stringifyOptional(placeSnapshot?.name);
      const address = stringifyOptional(placeSnapshot?.formattedAddress);
      const suffix = address ? ` (${address})` : placeName && placeName !== itemTitle ? ` (${placeName})` : "";
      lines.push(`- ${time ? `${time}: ` : ""}${itemTitle}${suffix}`);
    }
  }

  return lines.join("\n").trim();
}

export function shouldReplaceSynthesizedMessage(content: string) {
  return /\[object Object\]/i.test(content);
}

export function recoverSynthesizedMessage(
  content: string,
  toolResults: Array<{ name: string; output: unknown }>,
  fallbackMessage: string
) {
  if (!shouldReplaceSynthesizedMessage(content)) {
    return content;
  }

  const itineraryResult = [...toolResults]
    .reverse()
    .find((result) => result.name === "create_itinerary" || result.name === "update_itinerary");
  const summary = itineraryResult ? getItinerarySummary(itineraryResult.output) : null;
  return summary ?? fallbackMessage;
}
