import { z } from "zod";
import type { MapsProvider } from "../../../services/maps";
import {
  WEATHER_ATTRIBUTION,
  isWetCondition,
  type DailyWeather,
  type RawHourlyWeather,
  type WeatherProvider
} from "../../../services/weather";
import { addDays, daysBetween, isIsoDate, toIsoDate } from "../../../services/weather/dates";
import { describeHourlyForAgent, groupHoursByDate, summarizeHourlyDay } from "../../../services/weather/hourlyWeather";
import { getWeatherForDates, roundPoint } from "../../../services/weather/weatherOutlook";
import type { AgentTool, AgentToolService } from "../agentTools";
import { createRunRecord, toCompactMetadata } from "./toolUtils";

/** Longest range one call may cover: keeps the tool result small for the model. */
export const WEATHER_TOOL_MAX_DAYS = 14;
/** startDate may be at most this many days before today (UTC vs local "today" slack). */
const WEATHER_TOOL_MIN_START_OFFSET = -1;
/** startDate may be at most this many days after today: a year out, plus a leap day. */
const WEATHER_TOOL_MAX_START_OFFSET = 366;

const isoDateSchema = z.string().refine(isIsoDate, "Use a real date in YYYY-MM-DD format.");

// The cross-field refinements check isIsoDate themselves: they must never do date
// math on a string that failed the field check.
function bothDatesValid(value: { startDate: string; endDate?: string }): value is { startDate: string; endDate: string } {
  return value.endDate !== undefined && isIsoDate(value.startDate) && isIsoDate(value.endDate);
}

const weatherForecastInputSchema = z
  .object({
    placeName: z.string().trim().min(1).max(300),
    cityContext: z.string().trim().min(1).max(200).optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional()
  })
  .refine((value) => !bothDatesValid(value) || value.endDate >= value.startDate, {
    message: "endDate must be on or after startDate.",
    path: ["endDate"]
  })
  .refine((value) => !bothDatesValid(value) || daysBetween(value.startDate, value.endDate) < WEATHER_TOOL_MAX_DAYS, {
    message: `Request at most ${WEATHER_TOOL_MAX_DAYS} days per call.`,
    path: ["endDate"]
  });

/** Adds the today-relative startDate bound, so it is a recoverable input error. */
function inputSchemaFor(today: string) {
  return weatherForecastInputSchema.refine(
    (value) => {
      if (!isIsoDate(value.startDate)) return true;
      const offset = daysBetween(today, value.startDate);
      return offset >= WEATHER_TOOL_MIN_START_OFFSET && offset <= WEATHER_TOOL_MAX_START_OFFSET;
    },
    {
      message: `startDate must be between ${addDays(today, WEATHER_TOOL_MIN_START_OFFSET)} and ${addDays(today, WEATHER_TOOL_MAX_START_OFFSET)}.`,
      path: ["startDate"]
    }
  );
}

const CONDITION_TEXT: Record<DailyWeather["condition"], string> = {
  CLEAR: "Clear",
  PARTLY_CLOUDY: "Partly cloudy",
  CLOUDY: "Cloudy",
  FOG: "Fog",
  DRIZZLE: "Drizzle",
  RAIN: "Rain",
  HEAVY_RAIN: "Heavy rain",
  THUNDERSTORM: "Thunderstorms",
  SNOW: "Snow",
  UNKNOWN: "Mixed"
};

export function describeWeatherForAgent(weather: DailyWeather): string {
  const parts: string[] = [CONDITION_TEXT[weather.condition]];
  if (weather.temperatureMinC !== null && weather.temperatureMaxC !== null) {
    parts.push(`${Math.round(weather.temperatureMinC)}-${Math.round(weather.temperatureMaxC)}°C`);
  }
  if (weather.kind === "FORECAST" && weather.precipitationProbabilityPct !== null) {
    parts.push(`${weather.precipitationProbabilityPct}% chance of rain`);
  }
  if (weather.kind === "TYPICAL" && weather.wetYears !== null && weather.sampleYears !== null) {
    parts.push(`rain on ${weather.wetYears} of the last ${weather.sampleYears} years`);
  }
  return parts.join(", ");
}

export function isRainRisk(weather: DailyWeather): boolean {
  return isWetCondition(weather.condition) || (weather.precipitationProbabilityPct ?? 0) >= 60;
}

export function createWeatherForecastTool(options: {
  weather: WeatherProvider;
  geocoder: Pick<MapsProvider, "resolvePlace">;
  agentService: AgentToolService;
  typicalYears: number;
  now?: () => Date;
}): AgentTool {
  const now = options.now ?? (() => new Date());

  return {
    name: "weather_forecast",
    async execute(context, input) {
      const today = toIsoDate(now());
      const parsed = inputSchemaFor(today).parse(input);
      const endDate = parsed.endDate ?? parsed.startDate;
      const place = await options.geocoder.resolvePlace({
        placeName: parsed.placeName,
        cityContext: parsed.cityContext
      });

      const dates: string[] = [];
      for (let date = parsed.startDate; date <= endDate; date = addDays(date, 1)) dates.push(date);

      const lookups = await getWeatherForDates({
        provider: options.weather,
        location: place.location,
        dates,
        today,
        typicalYears: options.typicalYears
      });

      // Hour-by-hour timing turns "Thunderstorms" into "dry until 11 AM; thunderstorms 2 PM-8 PM",
      // so the model can put outdoor stops in the dry hours. Forecast days only; supplementary.
      const hasForecast = dates.some((date) => {
        const lookup = lookups.get(date);
        return lookup?.status === "OK" && lookup.weather.kind === "FORECAST";
      });
      let hoursByDate = new Map<string, RawHourlyWeather[]>();
      if (hasForecast) {
        try {
          // The same rounded point the daily lookup uses: both resolve to one grid cell and share cache entries.
          hoursByDate = groupHoursByDate(await options.weather.getHourlyForecast(roundPoint(place.location)));
        } catch (error) {
          console.error("[Weather] Hourly forecast lookup failed.", error instanceof Error ? error.message : error);
        }
      }

      const days = dates.map((date) => {
        const lookup = lookups.get(date);
        if (!lookup || lookup.status !== "OK") return { date, status: lookup?.status ?? "UNAVAILABLE" };
        const weather = lookup.weather;
        const base = {
          date,
          status: "OK",
          kind: weather.kind,
          condition: weather.condition,
          summary: describeWeatherForAgent(weather),
          rainRisk: isRainRisk(weather),
          temperatureMinC: weather.temperatureMinC,
          temperatureMaxC: weather.temperatureMaxC
        };
        if (weather.kind === "FORECAST") {
          const hours = hoursByDate.get(date);
          const outlook = hours ? summarizeHourlyDay(hours, []) : null;
          const timing = outlook ? describeHourlyForAgent(outlook) : null;
          return {
            ...base,
            ...(timing ? { summary: `${base.summary}; ${timing}`, timing } : {}),
            precipitationProbabilityPct: weather.precipitationProbabilityPct
          };
        }
        // A TYPICAL day's internal percentage is the share of past years that were wet.
        // Exposing it as a probability invites "40% chance of rain", so it is withheld
        // and the raw counts are given instead.
        return {
          ...base,
          precipitationProbabilityPct: null,
          wetYears: weather.wetYears,
          sampleYears: weather.sampleYears
        };
      });

      const hasTypical = days.some((day) => "kind" in day && day.kind === "TYPICAL");
      const result = {
        location: { name: place.name, latitude: place.location.latitude, longitude: place.location.longitude },
        days,
        ...(hasTypical
          ? { note: `TYPICAL days average the last ${options.typicalYears} years; they are not a forecast.` }
          : {}),
        attribution: WEATHER_ATTRIBUTION.text
      };

      // A source citation only makes sense when Open-Meteo actually supplied data.
      const hasWeather = days.some((day) => day.status === "OK");
      if (hasWeather) {
        await options.agentService.recordSources(createRunRecord(context), [
          {
            sourceType: "WEB",
            title: `Weather for ${place.name} (Open-Meteo)`,
            url: WEATHER_ATTRIBUTION.url,
            snippet: days
              .map((day) => `${day.date}: ${"summary" in day ? day.summary : day.status}`)
              .join("; ")
              .slice(0, 500),
            provider: "open_meteo",
            retrievedAt: new Date(),
            metadata: toCompactMetadata({ input: parsed, location: result.location })
          }
        ]);
      }

      return result;
    }
  };
}
