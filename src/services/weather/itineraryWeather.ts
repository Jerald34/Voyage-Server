import { addDays, isIsoDate, toIsoDate } from "./dates";
import { groupHoursByDate, summarizeHourlyDay, type HourlyDayOutlook } from "./hourlyWeather";
import { getWeatherForDates, roundPoint } from "./weatherOutlook";
import {
  WEATHER_ATTRIBUTION,
  type DailyWeather,
  type GeoPoint,
  type RawHourlyWeather,
  type WeatherLookup,
  type WeatherProvider
} from "./types";

/** The slice of an itinerary day that weather needs; agency and share reads both fit it. */
export type WeatherDayInput = {
  id: string;
  dayNumber: number;
  date: Date | string | null;
  items: Array<{
    id?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    placeSnapshot: { latitude: number | null; longitude: number | null } | null;
  }>;
};

export type DayWeatherStatus = "OK" | "NO_DATE" | "NO_LOCATION" | "PAST" | "UNAVAILABLE";

export type DayWeatherEntry = {
  dayId: string;
  dayNumber: number;
  date: string | null;
  status: DayWeatherStatus;
  weather: DailyWeather | null;
  /** Forecast days whose hourly lookup answered: when the rain falls, and each timed stop's weather. */
  hourly?: HourlyDayOutlook;
};

export type ItineraryWeather = {
  provider: WeatherProvider["name"] | null;
  attribution: { text: string; url: string } | null;
  days: DayWeatherEntry[];
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function locationKey(location: GeoPoint) {
  return `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
}

function entry(
  day: WeatherDayInput,
  date: string | null,
  status: DayWeatherStatus,
  weather: DailyWeather | null = null,
  hourly: HourlyDayOutlook | null = null
): DayWeatherEntry {
  return { dayId: day.id, dayNumber: day.dayNumber, date, status, weather, ...(hourly ? { hourly } : {}) };
}

/** The day's own date, else trip start + (dayNumber - 1): the client day cards use the same rule. */
export function resolveDayDate(
  day: Pick<WeatherDayInput, "date" | "dayNumber">,
  tripStartDate: Date | string | null
): string | null {
  const own = toDate(day.date);
  let result: string | null = null;
  if (own) {
    result = toIsoDate(own);
  } else {
    const start = toDate(tripStartDate);
    if (!start || !Number.isInteger(day.dayNumber) || day.dayNumber < 1) return null;
    const startIso = toIsoDate(start);
    // Years beyond 9999 serialise as "+010000-..." and break the date helpers.
    if (!isIsoDate(startIso)) return null;
    result = addDays(startIso, day.dayNumber - 1);
  }
  return isIsoDate(result) ? result : null;
}

/** The average position of the day's located stops. */
export function resolveDayLocation(day: Pick<WeatherDayInput, "items">): GeoPoint | null {
  const points: GeoPoint[] = [];
  for (const item of day.items ?? []) {
    const latitude = item?.placeSnapshot?.latitude;
    const longitude = item?.placeSnapshot?.longitude;
    if (typeof latitude === "number" && Number.isFinite(latitude) && typeof longitude === "number" && Number.isFinite(longitude)) {
      points.push({ latitude, longitude });
    }
  }
  if (points.length === 0) return null;
  const round = (value: number) => Math.round(value * 1e4) / 1e4;
  return {
    latitude: round(points.reduce((sum, point) => sum + point.latitude, 0) / points.length),
    longitude: round(points.reduce((sum, point) => sum + point.longitude, 0) / points.length)
  };
}

export async function buildItineraryWeather(options: {
  days: WeatherDayInput[];
  tripStartDate: Date | string | null;
  provider: WeatherProvider | null;
  now: Date;
  typicalYears: number;
}): Promise<ItineraryWeather> {
  const resolved = options.days.map((day) => ({
    day,
    date: resolveDayDate(day, options.tripStartDate),
    location: resolveDayLocation(day)
  }));

  const provider = options.provider;
  if (!provider) {
    return {
      provider: null,
      attribution: null,
      days: resolved.map(({ day, date }) => entry(day, date, date ? "UNAVAILABLE" : "NO_DATE"))
    };
  }

  // A day without stops (arrival, free day) borrows the first located day's position.
  const fallback = resolved.find((item) => item.location)?.location ?? null;
  const today = toIsoDate(options.now);

  const groups = new Map<string, { location: GeoPoint; dates: string[] }>();
  for (const item of resolved) {
    const location = item.location ?? fallback;
    if (!item.date || !location) continue;
    const key = locationKey(location);
    const group = groups.get(key) ?? { location, dates: [] };
    group.dates.push(item.date);
    groups.set(key, group);
  }

  const lookups = new Map<string, Map<string, WeatherLookup>>();
  await Promise.all(
    [...groups.entries()].map(async ([key, group]) => {
      try {
        lookups.set(
          key,
          await getWeatherForDates({
            provider,
            location: group.location,
            dates: group.dates,
            today,
            typicalYears: options.typicalYears
          })
        );
      } catch (error) {
        // Weather is supplementary: an unexpected failure must not reject the whole itinerary.
        console.error("[Weather] Itinerary weather lookup failed.", error instanceof Error ? error.message : error);
        lookups.set(key, new Map(group.dates.map((date): [string, WeatherLookup] => [date, { status: "UNAVAILABLE" }])));
      }
    })
  );

  // Hour-by-hour timing for forecast days: one more (cached) request per location.
  // Supplementary like the rest: on failure a day keeps its daily summary.
  const hoursByGroup = new Map<string, Map<string, RawHourlyWeather[]>>();
  await Promise.all(
    [...groups.entries()].map(async ([key, group]) => {
      const groupLookups = lookups.get(key);
      const hasForecast = group.dates.some((date) => {
        const lookup = groupLookups?.get(date);
        return lookup?.status === "OK" && lookup.weather.kind === "FORECAST";
      });
      if (!hasForecast) return;
      try {
        // The same rounded point the daily lookup uses: both resolve to one grid cell and share cache entries.
        hoursByGroup.set(key, groupHoursByDate(await provider.getHourlyForecast(roundPoint(group.location))));
      } catch (error) {
        console.error("[Weather] Hourly forecast lookup failed.", error instanceof Error ? error.message : error);
      }
    })
  );

  return {
    provider: provider.name,
    attribution: { ...WEATHER_ATTRIBUTION },
    days: resolved.map(({ day, date, location }) => {
      if (!date) return entry(day, null, "NO_DATE");
      const point = location ?? fallback;
      if (!point) return entry(day, date, "NO_LOCATION");
      const lookup = lookups.get(locationKey(point))?.get(date);
      if (!lookup) return entry(day, date, "UNAVAILABLE");
      if (lookup.status !== "OK") return entry(day, date, lookup.status);
      const hours = lookup.weather.kind === "FORECAST" ? hoursByGroup.get(locationKey(point))?.get(date) : undefined;
      const hourly = hours ? summarizeHourlyDay(hours, day.items ?? []) : null;
      return entry(day, date, "OK", lookup.weather, hourly);
    })
  };
}
