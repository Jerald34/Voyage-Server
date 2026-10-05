# Hourly Timing + Per-Stop Weather Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading "Thunderstorms · 100% chance of rain" day summary with when the rain actually falls ("Afternoon thunderstorms, 2–8 PM · dry until 11 AM"), and tag every timed stop with the weather during its time slot ("Likely dry", "Storms likely").

**Architecture:** The server already builds per-day weather from Open-Meteo's *daily* forecast, whose `weather_code` is the worst hour of the day and whose `precipitation_probability_max` is the wettest hour. We add one cached *hourly* forecast request per location. A pure module (`hourlyWeather.ts`) turns a date's 24 hourly rows plus the day's stop times into a small `hourly` block on each forecast day: the first wet daytime hour, the worst wet window, and one outlook per timed stop. The client stays display-only: `weatherDisplay.js` turns that block into words, and a new `StopWeatherTag` renders the stop outlook on the desktop day view, the mobile cards and the public share page. The PDF prints the same text. The agent's `weather_forecast` tool gets the same timing as one extra line.

**Tech Stack:** Voyage-Server (TypeScript, Express, Vitest), Voyage-Client (Next.js, React, Tailwind, Vitest + Testing Library, jsPDF). Open-Meteo forecast API (free, CC-BY 4.0).

---

## Background (why)

User report 2026-10-06: a Baguio trip for Oct 8–9 showed "Forecast: Thunderstorms · 100% chance of rain" while PAGASA said "partly cloudy with isolated rain showers". Open-Meteo's hourly forecast for Oct 8 showed 0–6% chance of rain until 9 AM, drizzle from 11 AM and thunderstorms 2–7 PM (about 19 mm). Both sources agree. The daily summary just reports the single worst hour as if it were the whole day. In the rainy season almost every Baguio day reads "Thunderstorms · 100%", so the itinerary's advice ("Plan indoor stops") is useless: it never says which stops.

## Design decisions (approved in chat 2026-10-06, option C of the A/B/C mockups)

- **D1 – Hourly data is server-side.** One extra Open-Meteo request per location: `hourly=weather_code,precipitation_probability`, `forecast_days=16`, `timezone=auto`. It is cached for 3 hours per ~1 km cell, the same as the daily forecast. The client never sees raw hours.
- **D2 – Only forecast days get timing.** Typical (past-years) days, and days whose hourly lookup fails, keep today's daily display unchanged. A failed hourly request only logs; the itinerary never fails because of it.
- **D3 – Daytime is 06:00–22:00 local.** Rain at night does not shape the day's headline. A day whose only rain is at night reads "Mostly dry".
- **D4 – Rain bands.** Storms (WMO 95–99) > rain (61–67, 80–82) > drizzle (51–57). The day's wet window covers every daytime hour in the worst band present. `toHour` is exclusive, so storms in the rows for 14:00…19:00 are shown as "2–8 PM". Each hourly row is treated as covering the hour that starts at its timestamp.
- **D5 – Stop outlook.** It covers the hours overlapping `[startTime, endTime)` in local clock time. A missing end, or an end at or before the start, counts as one hour. The outlook is the worst band in those hours. A dry-coded slot with any hour at ≥50% chance of rain becomes "Light rain possible". Labels: `DRY` "Likely dry", `SHOWERS` "Light rain possible", `RAIN` "Rain likely", `STORM` "Storms likely". Stops without an id or a readable start time get no tag.
- **D6 – One location per day.** Stops use the day's location (the average of its located stops, as today). Weather grid cells are ~10 km, so per-stop coordinates would add requests without changing the answer.
- **D7 – Wording** (all from the mockup, adjusted to the real data):
  - Day headline: `"{Morning|Afternoon|Evening} {thunderstorms|rain|heavy rain|drizzle}, {range}"`. When the spell lasts 9 hours or more: `"{Thunderstorms|Rain|…} on and off, {range}"`. The summary card keeps its existing "Forecast: " prefix.
  - Detail line: "Dry morning" (first wet hour ≥ noon) or "Dry until 11 AM" · "about 19 mm of rain" (daily total ≥ 1 mm) · "2 stops fall in the storm window" (screen only, not in the PDF).
  - Advice: "Put outdoor stops before 11 AM." when the first wet hour is 9 AM or later. Otherwise, the existing "Plan indoor stops or bring rain gear."
  - Chip: `"16–24°C · PM storms"`, `"AM rain"`, `"evening drizzle"`, `"rain on and off"`, or `"dry"`.
  - Dry daytime: label is the daily condition (or "Mostly dry" when the daily code is wet because of night rain), detail "No rain expected from 6 AM to 10 PM".
- **D8 – Surfaces.** Desktop day view (summary + tag next to each stop's time pill), mobile list (summary + tag in `CompactPlaceCard`), public share page (chip + tag in `ShareStopCard`), PDF (timed day line + stop weather after the stop's time). The agent tool adds `timing` to forecast days, and the prompt tells the model to put outdoor stops in the dry hours.
- **D9 – Edits refresh tags.** `useItineraryWeather` already refetches when the itinerary `version` changes, so moving a stop's time re-tags it with no extra work.

## Repos, branches, commits

- Two repos side by side: `Voyage-Server/` and `Voyage-Client/` under `C:\Users\dever\OneDrive\Documents\Voyage`. Paths below are relative to the repo named in each task.
- **Work on whatever branch is checked out in each repo (currently `staging`). Never create or switch branches.** The user manages branches in GitHub Desktop.
- Commit with `git add <exact paths>`, never `git add -A`/`.`. Voyage-Client has an unrelated, uncommitted day-card date fix (`app/lib/formatters.js`, `tests/formatters-day-card-date.test.js`, three test mocks) that must not be swept into these commits.
- No `Co-Authored-By` lines in commit messages.
- Test commands: server `npx vitest run <file>` (in `Voyage-Server`); client `npx vitest run --pool=threads <file>` (in `Voyage-Client`).
- Known baseline failures that are NOT regressions: server 11 tests, client 8 files / 1 test (`agent-command-center-places`).

## File structure

**Voyage-Server**
- Create `src/utils/clockTime.ts`. Clock-time parsing ("14:00", "2:00 PM"), moved out of `agentHeuristics.ts` so weather can use it.
- Modify `src/modules/agent/agentHeuristics.ts`. Import the two moved helpers.
- Modify `src/services/weather/types.ts`. Add `RawHourlyWeather` and `WeatherProvider.getHourlyForecast`.
- Modify `src/services/weather/openMeteo.ts`. Add `parseOpenMeteoHourly` and the provider's `getHourlyForecast`.
- Modify `src/services/weather/weatherCache.ts`. Cache hourly forecasts.
- Create `src/services/weather/hourlyWeather.ts`. Pure functions: `groupHoursByDate`, `summarizeHourlyDay`, `describeHourlyForAgent`.
- Modify `src/services/weather/itineraryWeather.ts`. Attach `hourly` to forecast days.
- Modify `src/modules/agent/tools/weatherTools.ts`. Add `timing` to forecast days.
- Modify `src/modules/agent/agentPrompts.ts`. Tell the model to use `timing`.
- Tests:
  - create `tests/clockTime.test.ts`, `tests/hourlyWeather.test.ts`, and `tests/baguioHourlyFixture.ts` (shared fixture, not a test file);
  - modify `tests/openMeteoProvider.test.ts`, `tests/weatherCache.test.ts`, `tests/itineraryWeather.test.ts`, `tests/weatherService.test.ts` and `tests/weatherTool.test.ts`.

**Voyage-Client**
- Modify `app/lib/weather/weatherDisplay.js`:
  - `formatHour` and `formatHourRange`;
  - hourly-aware `describeDayWeather`;
  - `describeStopWeather`;
  - `RAIN_ADVICE`.
- Create `app/components/weather/StopWeatherTag.jsx`, the per-stop tag (spans only, so it fits inside a button).
- Modify `app/components/trip-dashboard/pages/ItineraryDayView.jsx`. Add the tag beside the time pill.
- Modify `app/components/trip-dashboard/mobile/CompactPlaceCard.jsx`. Add a `dayWeather` prop and the tag.
- Modify `app/components/trip-dashboard/pages/ClientItineraryPage.jsx`. Pass `dayWeather` to mobile cards.
- Modify `app/itinerary/view/[token]/components/ShareStopCard.jsx`. Add a `dayWeather` prop and the tag.
- Modify `app/itinerary/view/[token]/page.jsx`. Pass `dayWeather` to share cards.
- Modify `app/lib/pdfExport.js`. Print the stop weather after the stop's time.
- Tests:
  - modify `tests/weather-display.test.js`, `tests/share-page-weather.test.jsx` and `tests/pdf-weather.test.js`;
  - create `tests/stop-weather-tag.test.jsx`.

---

## Task 1: Shared clock-time parser (server)

**Files:**
- Create: `Voyage-Server/src/utils/clockTime.ts`
- Modify: `Voyage-Server/src/modules/agent/agentHeuristics.ts:84-94` and `:124-141`
- Test: `Voyage-Server/tests/clockTime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/clockTime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeClockTime, parseClockTimeToMinutes } from "../src/utils/clockTime";

describe("normalizeClockTime", () => {
  it("adds missing minutes and upper-cases the meridiem", () => {
    expect(normalizeClockTime("9")).toBe("9:00");
    expect(normalizeClockTime(" 9:30 pm ")).toBe("9:30 PM");
  });

  it("returns anything else trimmed and unchanged", () => {
    expect(normalizeClockTime(" lunch ")).toBe("lunch");
  });
});

describe("parseClockTimeToMinutes", () => {
  it("reads 24-hour and 12-hour clock times", () => {
    expect(parseClockTimeToMinutes("09:30")).toBe(570);
    expect(parseClockTimeToMinutes("14")).toBe(840);
    expect(parseClockTimeToMinutes("9:30 PM")).toBe(1290);
    expect(parseClockTimeToMinutes("12:00 AM")).toBe(0);
    expect(parseClockTimeToMinutes("12:15 PM")).toBe(735);
  });

  it("returns null for text that is not a clock time", () => {
    expect(parseClockTimeToMinutes("noon")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/clockTime.test.ts`
Expected: FAIL. Cannot resolve `../src/utils/clockTime`.

- [ ] **Step 3: Create the module by moving the two helpers**

Create `src/utils/clockTime.ts`. The bodies are moved unchanged from `agentHeuristics.ts`:

```ts
/** "9" → "9:00", " 9:30 pm " → "9:30 PM". Anything else comes back trimmed and unchanged. */
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

/** Minutes after midnight for "14:00" or "2:00 PM"; null when the text is not a clock time. */
export function parseClockTimeToMinutes(value: string) {
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
```

In `src/modules/agent/agentHeuristics.ts`:
- Delete the `export function normalizeClockTime(value: string) { … }` block (lines 84–94).
- Delete the `function parseClockTimeToMinutes(value: string) { … }` block (lines 124–141).
- Add to the imports at the top:

```ts
import { normalizeClockTime, parseClockTimeToMinutes } from "../../utils/clockTime";
```

(`normalizeClockTime` was exported but nothing outside `agentHeuristics.ts` imports it; `grep -rn normalizeClockTime src tests` confirms.)

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/clockTime.test.ts`
Expected: PASS (4 tests).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/clockTime.ts src/modules/agent/agentHeuristics.ts tests/clockTime.test.ts
git commit -m "refactor(utils): share clock-time parsing outside the agent heuristics"
```

---

## Task 2: Hourly forecast from Open-Meteo (server)

**Files:**
- Modify: `Voyage-Server/src/services/weather/types.ts`
- Modify: `Voyage-Server/src/services/weather/openMeteo.ts`
- Test: `Voyage-Server/tests/openMeteoProvider.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/openMeteoProvider.test.ts`, change the import line to:

```ts
import { createOpenMeteoProvider, parseOpenMeteoDaily, parseOpenMeteoHourly } from "../src/services/weather/openMeteo";
```

Add below `const forecastBody = { … };`:

```ts
const hourlyBody = {
  latitude: 16.41,
  longitude: 120.59,
  timezone: "Asia/Manila",
  hourly: {
    time: ["2026-10-08T00:00", "2026-10-08T14:00", "not-a-time"],
    weather_code: [1, 95, 0],
    precipitation_probability: [3, 96, 0]
  }
};
```

Add inside `describe("Open-Meteo provider", …)`:

```ts
  it("requests a 16-day local-time hourly forecast and parses one row per hour", async () => {
    const urls: URL[] = [];
    const provider = createOpenMeteoProvider({
      fetchImpl: async (url) => {
        urls.push(new URL(String(url)));
        return jsonResponse(hourlyBody);
      }
    });

    const rows = await provider.getHourlyForecast({ latitude: 16.4023, longitude: 120.596 });

    expect(`${urls[0].origin}${urls[0].pathname}`).toBe("https://api.open-meteo.com/v1/forecast");
    expect(urls[0].searchParams.get("timezone")).toBe("auto");
    expect(urls[0].searchParams.get("forecast_days")).toBe("16");
    expect(urls[0].searchParams.get("hourly")).toBe("weather_code,precipitation_probability");
    expect(urls[0].searchParams.get("daily")).toBeNull();
    // The malformed timestamp is skipped, not guessed.
    expect(rows).toEqual([
      { date: "2026-10-08", hour: 0, weatherCode: 1, precipitationProbabilityPct: 3 },
      { date: "2026-10-08", hour: 14, weatherCode: 95, precipitationProbabilityPct: 96 }
    ]);
  });

  it("treats an hourly payload without hourly times as unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = createOpenMeteoProvider({ fetchImpl: async () => jsonResponse({ hourly: {} }) });

    await expect(provider.getHourlyForecast({ latitude: 1, longitude: 2 })).rejects.toMatchObject({
      statusCode: 503,
      code: "WEATHER_PROVIDER_UNAVAILABLE"
    } satisfies Partial<ApiError>);
    expect(() => parseOpenMeteoHourly({})).toThrow();
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/openMeteoProvider.test.ts`
Expected: FAIL. `parseOpenMeteoHourly` is not exported and `provider.getHourlyForecast is not a function`.

- [ ] **Step 3: Add the type and the provider method**

In `src/services/weather/types.ts`, add after `RawDailyWeather`:

```ts
/** One forecast hour in the location's own local time. The row covers the hour that starts at `hour`. */
export type RawHourlyWeather = {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local hour of day, 0-23. */
  hour: number;
  weatherCode: number | null;
  precipitationProbabilityPct: number | null;
};
```

and add to `WeatherProvider`, after `getDailyForecast`:

```ts
  /** Hourly forecast for the same 16 days, in the location's local time. */
  getHourlyForecast(location: GeoPoint): Promise<RawHourlyWeather[]>;
```

In `src/services/weather/openMeteo.ts`:
- change the type import to `import type { GeoPoint, RawDailyWeather, RawHourlyWeather, WeatherProvider } from "./types";`
- add after `HISTORY_DAILY_FIELDS`:

```ts
// Just what the timing needs: the condition and the chance of rain, per hour.
const FORECAST_HOURLY_FIELDS = ["weather_code", "precipitation_probability"] as const;

/** Open-Meteo's hourly timestamps with timezone=auto: local "YYYY-MM-DDTHH:00". */
const LOCAL_HOUR = /^(\d{4}-\d{2}-\d{2})T(\d{2}):00$/;
```

- add after `parseOpenMeteoDaily`:

```ts
/** Converts Open-Meteo's column-oriented `hourly` block into one row per local hour. */
export function parseOpenMeteoHourly(body: unknown): RawHourlyWeather[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw weatherUnavailable("Weather provider returned an invalid payload.");
  }
  const hourly = (body as { hourly?: unknown }).hourly;
  if (typeof hourly !== "object" || hourly === null || Array.isArray(hourly)) {
    throw weatherUnavailable("Weather provider returned no hourly data.");
  }

  const columns = hourly as Record<string, unknown>;
  const at = (name: string, index: number) => {
    const values = columns[name];
    return Array.isArray(values) ? finiteOrNull(values[index]) : null;
  };
  // Same reason as the daily parser: an empty result would be cached for hours.
  if (!Array.isArray(columns.time)) throw weatherUnavailable("Weather provider returned no hourly times.");

  const rows: RawHourlyWeather[] = [];
  columns.time.forEach((time, index) => {
    const match = typeof time === "string" ? LOCAL_HOUR.exec(time) : null;
    if (!match) return;
    rows.push({
      date: match[1],
      hour: Number(match[2]),
      weatherCode: at("weather_code", index),
      precipitationProbabilityPct: at("precipitation_probability", index)
    });
  });
  return rows;
}
```

- add to the object returned by `createOpenMeteoProvider`, after `getDailyForecast`:

```ts
    async getHourlyForecast(location) {
      const url = new URL(forecastUrl);
      setCoordinates(url, location);
      url.searchParams.set("hourly", FORECAST_HOURLY_FIELDS.join(","));
      url.searchParams.set("forecast_days", String(FORECAST_DAYS));
      return parseOpenMeteoHourly(await getJson(fetchImpl, url, timeoutMs));
    },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/openMeteoProvider.test.ts`
Expected: PASS.

`npx tsc --noEmit` now fails in `weatherCache.ts`, because the cached provider lacks `getHourlyForecast`. Task 3 fixes that; do not commit until it passes.

- [ ] **Step 5: Go straight to Task 3, then commit both together** (see Task 3, Step 5).

---

## Task 3: Cache hourly forecasts (server)

**Files:**
- Modify: `Voyage-Server/src/services/weather/weatherCache.ts`
- Test: `Voyage-Server/tests/weatherCache.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("createCachedWeatherProvider", …)` in `tests/weatherCache.test.ts`:

```ts
  it("caches hourly forecasts per ~1 km cell, separately from the daily forecast", async () => {
    const inner = {
      name: "open-meteo" as const,
      getDailyForecast: vi.fn(async () => []),
      getHourlyForecast: vi.fn(async () => []),
      getDailyHistory: vi.fn(async () => [])
    };
    const cached = createCachedWeatherProvider(inner);

    await cached.getHourlyForecast({ latitude: 16.4023, longitude: 120.5961 });
    await cached.getHourlyForecast({ latitude: 16.4049, longitude: 120.5951 });
    await cached.getDailyForecast({ latitude: 16.4023, longitude: 120.5961 });

    expect(inner.getHourlyForecast).toHaveBeenCalledTimes(1);
    expect(inner.getDailyForecast).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/weatherCache.test.ts`
Expected: FAIL. `cached.getHourlyForecast is not a function`.

- [ ] **Step 3: Add the hourly cache**

In `src/services/weather/weatherCache.ts`:
- change the type import to `import type { GeoPoint, RawDailyWeather, RawHourlyWeather, WeatherProvider } from "./types";`
- in `createCachedWeatherProvider`, add after the `forecasts` cache:

```ts
  const hourlyForecasts = createTtlCache<RawHourlyWeather[]>({
    ttlMs: FORECAST_CACHE_TTL_MS,
    maxEntries: MAX_CACHE_ENTRIES,
    now: options.now
  });
```

- add to the returned object, after `getDailyForecast`:

```ts
    getHourlyForecast(location) {
      return hourlyForecasts.get(cellKey(location), () => provider.getHourlyForecast(location));
    },
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/weatherCache.test.ts tests/openMeteoProvider.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit (Tasks 2 + 3)**

```bash
git add src/services/weather/types.ts src/services/weather/openMeteo.ts src/services/weather/weatherCache.ts tests/openMeteoProvider.test.ts tests/weatherCache.test.ts
git commit -m "feat(weather): fetch and cache Open-Meteo's hourly forecast"
```

---

## Task 4: Summarize a day's hours and its stops (server)

**Files:**
- Create: `Voyage-Server/src/services/weather/hourlyWeather.ts`
- Create: `Voyage-Server/tests/baguioHourlyFixture.ts`
- Test: `Voyage-Server/tests/hourlyWeather.test.ts`

- [ ] **Step 1: Create the shared fixture (real Open-Meteo data, Baguio, 2026-10-08)**

Create `tests/baguioHourlyFixture.ts`:

```ts
import type { RawHourlyWeather } from "../src/services/weather/types";

// Open-Meteo hourly forecast for Baguio (16.41, 120.60), 2026-10-08, pulled 2026-10-06.
// Dry until 9 AM, drizzle from 11 AM, thunderstorms 2-7 PM (rows 14-17 and 19), rain at 18.
const CODES = [1, 1, 0, 0, 1, 1, 3, 1, 0, 0, 0, 51, 3, 51, 95, 95, 95, 95, 80, 95, 51, 2, 3, 3];
const CHANCES = [3, 2, 2, 3, 5, 6, 3, 0, 4, 21, 45, 65, 79, 89, 96, 99, 99, 96, 91, 84, 73, 56, 36, 20];

export function baguioHours(date = "2026-10-08"): RawHourlyWeather[] {
  return CODES.map((weatherCode, hour) => ({ date, hour, weatherCode, precipitationProbabilityPct: CHANCES[hour] }));
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/hourlyWeather.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  describeHourlyForAgent,
  groupHoursByDate,
  summarizeHourlyDay
} from "../src/services/weather/hourlyWeather";
import type { RawHourlyWeather } from "../src/services/weather/types";
import { baguioHours } from "./baguioHourlyFixture";

const hoursWith = (codes: Record<number, number>, chance = 10): RawHourlyWeather[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    date: "2026-10-08",
    hour,
    weatherCode: codes[hour] ?? 1,
    precipitationProbabilityPct: chance
  }));

describe("summarizeHourlyDay", () => {
  it("finds the first wet daytime hour and the worst wet window", () => {
    const outlook = summarizeHourlyDay(baguioHours(), []);

    expect(outlook).toEqual({
      firstWetHour: 11,
      // Storm rows 14-17 and 19 (18 is plain rain): the window ends after the 19:00 row.
      wetWindow: { condition: "THUNDERSTORM", fromHour: 14, toHour: 20 },
      stops: []
    });
  });

  it("gives each timed stop the worst weather in the hours it overlaps", () => {
    const outlook = summarizeHourlyDay(baguioHours(), [
      { id: "s1", startTime: "09:00", endTime: "11:00" },
      { id: "s2", startTime: "11:30", endTime: "13:00" },
      { id: "s3", startTime: "14:00", endTime: "16:30" },
      { id: "s4", startTime: "6:00 PM", endTime: "7:30 PM" },
      { id: "s5", startTime: null, endTime: null },
      { id: "s6", startTime: "10:00" },
      { id: "s7", startTime: "08:00", endTime: "07:00" },
      { id: "s8", startTime: "12:00", endTime: "12:45" },
      { id: null, startTime: "09:00" },
      { id: "s9", startTime: "lunch" }
    ]);

    expect(outlook?.stops).toEqual([
      { itemId: "s1", outlook: "DRY", maxPrecipitationProbabilityPct: 45 },
      { itemId: "s2", outlook: "SHOWERS", maxPrecipitationProbabilityPct: 79 },
      { itemId: "s3", outlook: "STORM", maxPrecipitationProbabilityPct: 99 },
      // 18:00 rain + 19:00 storm: the storm wins.
      { itemId: "s4", outlook: "STORM", maxPrecipitationProbabilityPct: 91 },
      // No end time: one hour.
      { itemId: "s6", outlook: "DRY", maxPrecipitationProbabilityPct: 45 },
      // End before start: one hour.
      { itemId: "s7", outlook: "DRY", maxPrecipitationProbabilityPct: 4 },
      // Overcast (code 3) but a 79% chance: light rain possible.
      { itemId: "s8", outlook: "SHOWERS", maxPrecipitationProbabilityPct: 79 }
    ]);
  });

  it("ignores rain at night", () => {
    const outlook = summarizeHourlyDay(hoursWith({ 0: 95, 1: 95, 2: 63, 23: 61 }), []);

    expect(outlook).toEqual({ firstWetHour: null, wetWindow: null, stops: [] });
  });

  it("names the heaviest condition within the worst band", () => {
    const outlook = summarizeHourlyDay(hoursWith({ 9: 61, 10: 65, 13: 51 }), []);

    expect(outlook?.wetWindow).toEqual({ condition: "HEAVY_RAIN", fromHour: 9, toHour: 11 });
    expect(outlook?.firstWetHour).toBe(9);
  });

  it("returns null when the date has no hours", () => {
    expect(summarizeHourlyDay([], [{ id: "s1", startTime: "09:00" }])).toBeNull();
  });
});

describe("groupHoursByDate", () => {
  it("groups rows by local date in hour order", () => {
    const grouped = groupHoursByDate([
      { date: "2026-10-09", hour: 1, weatherCode: 1, precipitationProbabilityPct: 0 },
      { date: "2026-10-08", hour: 5, weatherCode: 1, precipitationProbabilityPct: 0 },
      { date: "2026-10-09", hour: 0, weatherCode: 1, precipitationProbabilityPct: 0 }
    ]);

    expect([...grouped.keys()]).toEqual(["2026-10-09", "2026-10-08"]);
    expect(grouped.get("2026-10-09")?.map((row) => row.hour)).toEqual([0, 1]);
  });
});

describe("describeHourlyForAgent", () => {
  it("says when the day is dry and when the worst weather comes", () => {
    expect(describeHourlyForAgent(summarizeHourlyDay(baguioHours(), [])!)).toBe(
      "dry until 11 AM; thunderstorms 2 PM-8 PM"
    );
    expect(describeHourlyForAgent({ firstWetHour: null, wetWindow: null, stops: [] })).toBe("dry from 6 AM to 10 PM");
    expect(
      describeHourlyForAgent({ firstWetHour: 6, wetWindow: { condition: "RAIN", fromHour: 6, toHour: 9 }, stops: [] })
    ).toBe("rain 6 AM-9 AM");
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run tests/hourlyWeather.test.ts`
Expected: FAIL. Cannot resolve `../src/services/weather/hourlyWeather`.

- [ ] **Step 4: Write the module**

Create `src/services/weather/hourlyWeather.ts`:

```ts
import { parseClockTimeToMinutes } from "../../utils/clockTime";
import { CONDITION_SEVERITY, conditionFromWmoCode, isWetCondition } from "./weatherCodes";
import type { RawHourlyWeather, WeatherCondition } from "./types";

/** The hours travelers are out: 06:00 up to 22:00. Rain at night does not shape the day. */
export const DAYTIME_START_HOUR = 6;
export const DAYTIME_END_HOUR = 22;
/** A stop with no usable end time counts as one hour long. */
const DEFAULT_STOP_MINUTES = 60;
const MINUTES_PER_DAY = 24 * 60;
/** A dry-looking hour with at least this chance of rain still reads "light rain possible". */
export const SHOWER_CHANCE_PCT = 50;

export type StopRainOutlook = "DRY" | "SHOWERS" | "RAIN" | "STORM";

export type StopWeather = {
  itemId: string;
  outlook: StopRainOutlook;
  /** Highest hourly chance of rain during the stop; null when the provider gave none. */
  maxPrecipitationProbabilityPct: number | null;
};

export type HourlyDayOutlook = {
  /** First daytime hour (local, 0-23) with drizzle, rain or storms; null when the daytime stays dry. */
  firstWetHour: number | null;
  /** The daytime's worst wet weather and the local hours it spans (toHour exclusive); null when dry. */
  wetWindow: { condition: WeatherCondition; fromHour: number; toHour: number } | null;
  /** One entry per stop that has an id and a readable start time. */
  stops: StopWeather[];
};

/** The slice of an itinerary item the stop weather needs. */
export type HourlyStopInput = { id?: string | null; startTime?: string | null; endTime?: string | null };

const OUTLOOK_RANK: Record<StopRainOutlook, number> = { DRY: 0, SHOWERS: 1, RAIN: 2, STORM: 3 };

/** Storms, rain, drizzle: the three bands the day and stop wording use. */
function rainBand(condition: WeatherCondition): StopRainOutlook {
  if (condition === "THUNDERSTORM") return "STORM";
  if (condition === "RAIN" || condition === "HEAVY_RAIN") return "RAIN";
  if (condition === "DRIZZLE") return "SHOWERS";
  return "DRY";
}

function worseOutlook(a: StopRainOutlook, b: StopRainOutlook) {
  return OUTLOOK_RANK[b] > OUTLOOK_RANK[a] ? b : a;
}

function clockMinutes(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const minutes = parseClockTimeToMinutes(value);
  return minutes !== null && minutes >= 0 && minutes < MINUTES_PER_DAY ? minutes : null;
}

/** Rows keyed by local date, each date's rows in hour order. */
export function groupHoursByDate(rows: RawHourlyWeather[]): Map<string, RawHourlyWeather[]> {
  const byDate = new Map<string, RawHourlyWeather[]>();
  for (const row of rows) {
    const list = byDate.get(row.date);
    if (list) list.push(row);
    else byDate.set(row.date, [row]);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.hour - b.hour);
  return byDate;
}

function stopWeather(item: HourlyStopInput, byHour: Map<number, RawHourlyWeather>): StopWeather | null {
  if (!item.id) return null;
  const start = clockMinutes(item.startTime);
  if (start === null) return null;
  const end = clockMinutes(item.endTime);
  // A missing end, or one at or before the start (past midnight), counts as one hour.
  const stopEnd = end !== null && end > start ? end : Math.min(start + DEFAULT_STOP_MINUTES, MINUTES_PER_DAY);

  let outlook: StopRainOutlook = "DRY";
  let maxChance: number | null = null;
  let covered = false;
  for (let hour = Math.floor(start / 60); hour <= Math.floor((stopEnd - 1) / 60); hour += 1) {
    const row = byHour.get(hour);
    if (!row) continue;
    covered = true;
    outlook = worseOutlook(outlook, rainBand(conditionFromWmoCode(row.weatherCode)));
    if (row.precipitationProbabilityPct !== null) {
      maxChance = Math.max(maxChance ?? 0, row.precipitationProbabilityPct);
    }
  }
  if (!covered) return null;
  if (outlook === "DRY" && maxChance !== null && maxChance >= SHOWER_CHANCE_PCT) outlook = "SHOWERS";
  return { itemId: item.id, outlook, maxPrecipitationProbabilityPct: maxChance };
}

/**
 * When one date's rain falls, and what it means for each timed stop. `hours`
 * holds that date's rows; stop times are local clock times, like the rows.
 * Null when there are no rows for the date.
 */
export function summarizeHourlyDay(hours: RawHourlyWeather[], items: HourlyStopInput[]): HourlyDayOutlook | null {
  if (hours.length === 0) return null;
  const byHour = new Map(hours.map((row) => [row.hour, row]));

  const wet = hours
    .filter((row) => row.hour >= DAYTIME_START_HOUR && row.hour < DAYTIME_END_HOUR)
    .map((row) => ({ hour: row.hour, condition: conditionFromWmoCode(row.weatherCode) }))
    .filter((row) => isWetCondition(row.condition))
    .sort((a, b) => a.hour - b.hour);

  let wetWindow: HourlyDayOutlook["wetWindow"] = null;
  if (wet.length > 0) {
    const band = wet.reduce<StopRainOutlook>((worst, row) => worseOutlook(worst, rainBand(row.condition)), "DRY");
    const inBand = wet.filter((row) => rainBand(row.condition) === band);
    const condition = inBand.reduce<WeatherCondition>(
      (worst, row) => (CONDITION_SEVERITY[row.condition] > CONDITION_SEVERITY[worst] ? row.condition : worst),
      inBand[0].condition
    );
    wetWindow = { condition, fromHour: inBand[0].hour, toHour: inBand[inBand.length - 1].hour + 1 };
  }

  return {
    firstWetHour: wet.length > 0 ? wet[0].hour : null,
    wetWindow,
    stops: items.map((item) => stopWeather(item, byHour)).filter((stop): stop is StopWeather => stop !== null)
  };
}

const AGENT_WET_WORDS: Partial<Record<WeatherCondition, string>> = {
  DRIZZLE: "drizzle",
  RAIN: "rain",
  HEAVY_RAIN: "heavy rain",
  THUNDERSTORM: "thunderstorms"
};

function formatHour(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}

/** The day's timing in one line for the agent, e.g. "dry until 11 AM; thunderstorms 2 PM-8 PM". */
export function describeHourlyForAgent(outlook: HourlyDayOutlook): string {
  const window = outlook.wetWindow;
  if (!window) return `dry from ${formatHour(DAYTIME_START_HOUR)} to ${formatHour(DAYTIME_END_HOUR)}`;
  const parts: string[] = [];
  if (outlook.firstWetHour !== null && outlook.firstWetHour > DAYTIME_START_HOUR) {
    parts.push(`dry until ${formatHour(outlook.firstWetHour)}`);
  }
  parts.push(`${AGENT_WET_WORDS[window.condition] ?? "rain"} ${formatHour(window.fromHour)}-${formatHour(window.toHour)}`);
  return parts.join("; ");
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run tests/hourlyWeather.test.ts`
Expected: PASS (7 tests).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/weather/hourlyWeather.ts tests/hourlyWeather.test.ts tests/baguioHourlyFixture.ts
git commit -m "feat(weather): summarize a day's rain timing and each stop's weather from hourly data"
```

---

## Task 5: Attach `hourly` to itinerary forecast days (server)

**Files:**
- Modify: `Voyage-Server/src/services/weather/itineraryWeather.ts`
- Test: `Voyage-Server/tests/itineraryWeather.test.ts`
- Test: `Voyage-Server/tests/weatherService.test.ts` (fake provider only)

- [ ] **Step 1: Write the failing tests**

In `tests/itineraryWeather.test.ts`:
- change the type import to `import type { RawDailyWeather, RawHourlyWeather } from "../src/services/weather/types";`
- add `import { baguioHours } from "./baguioHourlyFixture";`
- replace the `provider` helper with:

```ts
function provider(rows: RawDailyWeather[]) {
  return {
    name: "open-meteo" as const,
    getDailyForecast: vi.fn(async () => rows),
    getHourlyForecast: vi.fn(async (): Promise<RawHourlyWeather[]> => []),
    getDailyHistory: vi.fn(async () => [])
  };
}
```

- add inside `describe("buildItineraryWeather", …)`:

```ts
  it("adds rain timing and per-stop weather to forecast days", async () => {
    const weather = provider([forecastRow("2026-10-10")]);
    weather.getHourlyForecast.mockResolvedValue(baguioHours("2026-10-10"));

    const result = await buildItineraryWeather({
      days: [
        {
          id: "day-1",
          dayNumber: 1,
          date: "2026-10-10",
          items: [
            { id: "s1", startTime: "09:00", endTime: "11:00", ...stop(16.4023, 120.596) },
            { id: "s3", startTime: "14:00", endTime: "16:30", ...stop(16.4023, 120.596) }
          ]
        }
      ],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });

    expect(weather.getHourlyForecast).toHaveBeenCalledTimes(1);
    expect(weather.getHourlyForecast).toHaveBeenCalledWith({ latitude: 16.4023, longitude: 120.596 });
    expect(result.days[0]).toMatchObject({ status: "OK", weather: { kind: "FORECAST" } });
    expect(result.days[0].hourly).toEqual({
      firstWetHour: 11,
      wetWindow: { condition: "THUNDERSTORM", fromHour: 14, toHour: 20 },
      stops: [
        { itemId: "s1", outlook: "DRY", maxPrecipitationProbabilityPct: 45 },
        { itemId: "s3", outlook: "STORM", maxPrecipitationProbabilityPct: 99 }
      ]
    });
  });

  it("keeps the daily summary when the hourly lookup fails", async () => {
    const weather = provider([forecastRow("2026-10-10")]);
    weather.getHourlyForecast.mockRejectedValue(new Error("hourly down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await buildItineraryWeather({
      days: [{ id: "day-1", dayNumber: 1, date: "2026-10-10", items: [stop(16.4, 120.6)] }],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });

    expect(result.days[0]).toMatchObject({ status: "OK", weather: { kind: "FORECAST" } });
    expect(result.days[0]).not.toHaveProperty("hourly");
    vi.restoreAllMocks();
  });

  it("asks for hours only where a day is a forecast", async () => {
    const weather = provider([]);

    await buildItineraryWeather({
      // Ten weeks out: typical weather, never hourly.
      days: [{ id: "day-1", dayNumber: 1, date: "2026-12-10", items: [stop(16.4, 120.6)] }],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });

    expect(weather.getHourlyForecast).not.toHaveBeenCalled();
  });
```

In `tests/weatherService.test.ts`, add `getHourlyForecast: vi.fn(async () => []),` to the object returned by `forecastProvider()`, after `getDailyForecast`. This keeps that test's output free of the hourly-failure log.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/itineraryWeather.test.ts`
Expected: FAIL on the first new test (`getHourlyForecast` not called; `hourly` undefined).

- [ ] **Step 3: Attach the hourly summary**

In `src/services/weather/itineraryWeather.ts`:

Replace the imports with:

```ts
import { addDays, isIsoDate, toIsoDate } from "./dates";
import { groupHoursByDate, summarizeHourlyDay, type HourlyDayOutlook } from "./hourlyWeather";
import { getWeatherForDates } from "./weatherOutlook";
import {
  WEATHER_ATTRIBUTION,
  type DailyWeather,
  type GeoPoint,
  type RawHourlyWeather,
  type WeatherLookup,
  type WeatherProvider
} from "./types";
```

Replace `WeatherDayInput` with:

```ts
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
```

Add to `DayWeatherEntry`, after `weather`:

```ts
  /** Forecast days whose hourly lookup answered: when the rain falls, and each timed stop's weather. */
  hourly?: HourlyDayOutlook;
```

Replace `entry` with:

```ts
function entry(
  day: WeatherDayInput,
  date: string | null,
  status: DayWeatherStatus,
  weather: DailyWeather | null = null,
  hourly: HourlyDayOutlook | null = null
): DayWeatherEntry {
  return { dayId: day.id, dayNumber: day.dayNumber, date, status, weather, ...(hourly ? { hourly } : {}) };
}
```

In `buildItineraryWeather`, insert between the `await Promise.all(...)` that fills `lookups` and the final `return { … }`:

```ts
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
        hoursByGroup.set(key, groupHoursByDate(await provider.getHourlyForecast(group.location)));
      } catch (error) {
        console.error("[Weather] Hourly forecast lookup failed.", error instanceof Error ? error.message : error);
      }
    })
  );
```

In the final `days: resolved.map(...)`, replace the last two lines of the callback:

```ts
      if (!lookup) return entry(day, date, "UNAVAILABLE");
      return lookup.status === "OK" ? entry(day, date, "OK", lookup.weather) : entry(day, date, lookup.status);
```

with:

```ts
      if (!lookup) return entry(day, date, "UNAVAILABLE");
      if (lookup.status !== "OK") return entry(day, date, lookup.status);
      const hours = lookup.weather.kind === "FORECAST" ? hoursByGroup.get(locationKey(point))?.get(date) : undefined;
      const hourly = hours ? summarizeHourlyDay(hours, day.items ?? []) : null;
      return entry(day, date, "OK", lookup.weather, hourly);
```

(No change is needed in `src/modules/weather/weatherService.ts`. Agency reads (`itineraryService.getItinerary`) and share reads (`includeItineraryPublicDetails`) both return items with `id`, `startTime` and `endTime`.)

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/itineraryWeather.test.ts tests/weatherService.test.ts tests/weatherRoutes.test.ts`
Expected: PASS. The existing exact-shape `toEqual` tests still pass because `hourly` is only added when present.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/weather/itineraryWeather.ts tests/itineraryWeather.test.ts tests/weatherService.test.ts
git commit -m "feat(weather): add rain timing and per-stop weather to itinerary forecast days"
```

---

## Task 6: Give the agent the same timing (server)

**Files:**
- Modify: `Voyage-Server/src/modules/agent/tools/weatherTools.ts`
- Modify: `Voyage-Server/src/modules/agent/agentPrompts.ts:37` and `:72`
- Test: `Voyage-Server/tests/weatherTool.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/weatherTool.test.ts`:
- add imports:

```ts
import type { RawHourlyWeather } from "../src/services/weather/types";
import { baguioHours } from "./baguioHourlyFixture";
```

- in `buildTool()`, add to the `weather` object after `getDailyForecast: …,`:

```ts
    getHourlyForecast: vi.fn(async (): Promise<RawHourlyWeather[]> => []),
```

- add inside `describe("weather_forecast tool", …)`:

```ts
  it("adds hour-by-hour timing to forecast days", async () => {
    const { tool, weather } = buildTool();
    weather.getHourlyForecast.mockResolvedValue(baguioHours("2026-10-10"));

    const result = await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" });

    expect(weather.getHourlyForecast).toHaveBeenCalledWith({ latitude: 16.4023, longitude: 120.596 });
    expect(result).toMatchObject({
      days: [
        {
          summary: "Rain, 16-23°C, 85% chance of rain; dry until 11 AM; thunderstorms 2 PM-8 PM",
          timing: "dry until 11 AM; thunderstorms 2 PM-8 PM"
        }
      ]
    });
  });

  it("skips the hourly request without forecast days and survives its failure", async () => {
    const { tool, weather } = buildTool();

    // Two months out: typical weather only.
    await tool.execute(context, { placeName: "Baguio City", startDate: "2026-12-01" });
    expect(weather.getHourlyForecast).not.toHaveBeenCalled();

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    weather.getHourlyForecast.mockRejectedValue(new Error("hourly down"));
    const result = await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" });

    expect(result).toMatchObject({ days: [{ summary: "Rain, 16-23°C, 85% chance of rain" }] });
    expect(result).not.toHaveProperty("days.0.timing");
    vi.restoreAllMocks();
  });
```

- in the existing prompt test (the one calling `buildVoyageSystemPrompt("weather_forecast, add_itinerary_item")`), add:

```ts
    expect(prompt).toContain("When a day also has timing");
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/weatherTool.test.ts`
Expected: FAIL. No `timing`, `getHourlyForecast` not called, and the prompt text is missing.

- [ ] **Step 3: Add timing to the tool**

In `src/modules/agent/tools/weatherTools.ts`:
- change the weather import to:

```ts
import {
  WEATHER_ATTRIBUTION,
  isWetCondition,
  type DailyWeather,
  type RawHourlyWeather,
  type WeatherProvider
} from "../../../services/weather";
import { describeHourlyForAgent, groupHoursByDate, summarizeHourlyDay } from "../../../services/weather/hourlyWeather";
```

- in `execute`, insert right after the `const lookups = await getWeatherForDates({ … });` call:

```ts
      // Hour-by-hour timing turns "Thunderstorms" into "dry until 11 AM; thunderstorms 2 PM-8 PM",
      // so the model can put outdoor stops in the dry hours. Forecast days only; supplementary.
      const hasForecast = dates.some((date) => {
        const lookup = lookups.get(date);
        return lookup?.status === "OK" && lookup.weather.kind === "FORECAST";
      });
      let hoursByDate = new Map<string, RawHourlyWeather[]>();
      if (hasForecast) {
        try {
          hoursByDate = groupHoursByDate(await options.weather.getHourlyForecast(place.location));
        } catch (error) {
          console.error("[Weather] Hourly forecast lookup failed.", error instanceof Error ? error.message : error);
        }
      }
```

- replace the FORECAST branch in `days`:

```ts
        if (weather.kind === "FORECAST") {
          return { ...base, precipitationProbabilityPct: weather.precipitationProbabilityPct };
        }
```

with:

```ts
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
```

- [ ] **Step 4: Teach the prompt**

In `src/modules/agent/agentPrompts.ts`:
- line 37: change the tool description string to:

```ts
    "weather_forecast: daily weather for a place and date range - a real forecast up to about 15 days ahead (with hour-by-hour timing), typical weather from past years for later dates.",
```

- line 72 ("Weather Check: …"): append this sentence inside the string, right after "…add a short rain backup in clientNotes for any outdoor stop.":

```
 When a day also has timing, put outdoor stops in its dry hours and covered stops inside the wet window it names.
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run tests/weatherTool.test.ts tests/agentOrchestrator.test.ts`
Expected: `weatherTool` PASS. `agentOrchestrator` shows only its known baseline failures (4 stale `itinerary.created` expectations) and no new ones.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/agent/tools/weatherTools.ts src/modules/agent/agentPrompts.ts tests/weatherTool.test.ts
git commit -m "feat(agent): give weather_forecast hour-by-hour rain timing"
```

---

## Task 7: Server checkpoint

- [ ] **Step 1: Full suite + typecheck + build**

Run (in `Voyage-Server`): `npx tsc --noEmit && npx vitest run`
Expected: tsc clean. Vitest failures are exactly the 11 known baseline tests and nothing in the weather or clock files.

- [ ] **Step 2: Live smoke check (read-only, public API)**

Run (in `Voyage-Server`):

```bash
npx tsx -e "import('./src/services/weather/openMeteo').then(async ({ createOpenMeteoProvider }) => { const { summarizeHourlyDay, groupHoursByDate } = await import('./src/services/weather/hourlyWeather'); const rows = await createOpenMeteoProvider().getHourlyForecast({ latitude: 16.41, longitude: 120.6 }); const [date, hours] = [...groupHoursByDate(rows)][2]; console.log(date, JSON.stringify(summarizeHourlyDay(hours, [{ id: 'x', startTime: '09:00', endTime: '11:00' }]))); })"
```

Expected: one line with a date two days out and an outlook object (values vary with the live forecast). If `tsx` is unavailable, skip this step and note it.

---

## Task 8: Hourly-aware day wording (client)

**Files:**
- Modify: `Voyage-Client/app/lib/weather/weatherDisplay.js`
- Test: `Voyage-Client/tests/weather-display.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/weather-display.test.js`, extend the import from `../app/lib/weather/weatherDisplay.js` with `describeStopWeather, formatHour, formatHourRange` (keep the existing names). Then append:

```js
const baguio = {
  date: "2026-10-08",
  kind: "FORECAST",
  condition: "THUNDERSTORM",
  temperatureMinC: 15.5,
  temperatureMaxC: 23.6,
  precipitationProbabilityPct: 99,
  precipitationMm: 19.3,
  uvIndexMax: 7,
  windSpeedMaxKph: 12,
  sampleYears: null,
  wetYears: null,
};

const baguioHourly = {
  firstWetHour: 11,
  wetWindow: { condition: "THUNDERSTORM", fromHour: 14, toHour: 20 },
  stops: [
    { itemId: "s1", outlook: "DRY", maxPrecipitationProbabilityPct: 45 },
    { itemId: "s2", outlook: "SHOWERS", maxPrecipitationProbabilityPct: 79 },
    { itemId: "s3", outlook: "STORM", maxPrecipitationProbabilityPct: 99 },
    { itemId: "s4", outlook: "STORM", maxPrecipitationProbabilityPct: 91 },
  ],
};

const timed = (weather, hourly) => ({ ...ok(weather), hourly });

describe("formatHour / formatHourRange", () => {
  it("writes 12-hour clock hours and shares the meridiem inside one half of the day", () => {
    expect(formatHour(0)).toBe("12 AM");
    expect(formatHour(12)).toBe("12 PM");
    expect(formatHour(14)).toBe("2 PM");
    expect(formatHourRange(14, 20)).toBe("2–8 PM");
    expect(formatHourRange(7, 10)).toBe("7–10 AM");
    expect(formatHourRange(11, 14)).toBe("11 AM–2 PM");
  });
});

describe("describeDayWeather with hourly timing", () => {
  it("says when the storms come instead of reporting the day's worst hour", () => {
    expect(describeDayWeather(timed(baguio, baguioHourly))).toEqual({
      condition: "THUNDERSTORM",
      label: "Afternoon thunderstorms, 2–8 PM",
      temperature: "16–24°C",
      rain: "Dry until 11 AM · about 19 mm of rain · 2 stops fall in the storm window",
      isTypical: false,
      isWet: true,
      compactText: "16–24°C · PM storms",
      ariaLabel: "Forecast: Afternoon thunderstorms, 2–8 PM, 16–24°C, dry until 11 AM, about 19 mm of rain",
      advice: ["Put outdoor stops before 11 AM."],
      pdfText: "Weather forecast: Afternoon thunderstorms, 2–8 PM, 16–24°C, dry until 11 AM, about 19 mm of rain",
    });
  });

  it("names morning and evening spells, and long spells as on and off", () => {
    const at = (condition, fromHour, toHour) =>
      describeDayWeather(timed(baguio, { firstWetHour: fromHour, wetWindow: { condition, fromHour, toHour }, stops: [] }));

    expect(at("DRIZZLE", 7, 10)).toMatchObject({ label: "Morning drizzle, 7–10 AM", compactText: "16–24°C · AM drizzle" });
    expect(at("RAIN", 18, 21)).toMatchObject({ label: "Evening rain, 6–9 PM", compactText: "16–24°C · evening rain" });
    expect(at("RAIN", 8, 20)).toMatchObject({ label: "Rain on and off, 8 AM–8 PM", compactText: "16–24°C · rain on and off" });
    // Wet from early morning: the generic tip, not "before 7 AM".
    expect(at("DRIZZLE", 7, 10).advice).toEqual(["Plan indoor stops or bring rain gear."]);
  });

  it("calls a day whose only rain falls at night mostly dry", () => {
    expect(describeDayWeather(timed(baguio, { firstWetHour: null, wetWindow: null, stops: [] }))).toEqual({
      condition: "CLOUDY",
      label: "Mostly dry",
      temperature: "16–24°C",
      rain: "No rain expected from 6 AM to 10 PM",
      isTypical: false,
      isWet: false,
      compactText: "16–24°C · dry",
      ariaLabel: "Forecast: Mostly dry, 16–24°C, no rain expected from 6 AM to 10 PM",
      advice: [],
      pdfText: "Weather forecast: Mostly dry, 16–24°C, no rain expected from 6 AM to 10 PM",
    });
  });

  it("keeps a dry day's own condition when the daily code is dry too", () => {
    const sunny = { ...baguio, condition: "PARTLY_CLOUDY" };
    expect(describeDayWeather(timed(sunny, { firstWetHour: null, wetWindow: null, stops: [] }))).toMatchObject({
      condition: "PARTLY_CLOUDY",
      label: "Partly cloudy",
    });
  });

  it("ignores hourly data on typical days", () => {
    expect(describeDayWeather({ ...ok(typical), hourly: baguioHourly }).compactText).toBe("15–23°C · rain 2/5 yrs");
  });
});

describe("describeStopWeather", () => {
  it("describes each timed stop from the day's hourly summary", () => {
    const entry = timed(baguio, baguioHourly);

    expect(describeStopWeather(entry, "s1")).toEqual({
      outlook: "DRY",
      label: "Likely dry",
      condition: "CLEAR",
      tone: "dry",
      ariaLabel: "Weather during this stop: Likely dry",
      pdfText: "Likely dry",
    });
    expect(describeStopWeather(entry, "s3")).toEqual({
      outlook: "STORM",
      label: "Storms likely",
      condition: "THUNDERSTORM",
      tone: "storm",
      ariaLabel: "Weather during this stop: Storms likely, up to 99% chance of rain",
      pdfText: "Storms likely (up to 99% chance of rain)",
    });
    expect(describeStopWeather(entry, "s2")).toMatchObject({ label: "Light rain possible", condition: "DRIZZLE", tone: "wet" });
  });

  it("returns null without hourly data, for an unknown stop, or for a day that is not OK", () => {
    expect(describeStopWeather(ok(baguio), "s1")).toBeNull();
    expect(describeStopWeather(timed(baguio, baguioHourly), "missing")).toBeNull();
    expect(describeStopWeather({ ...timed(baguio, baguioHourly), status: "PAST" }, "s1")).toBeNull();
    expect(describeStopWeather(null, "s1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run --pool=threads tests/weather-display.test.js`
Expected: FAIL. `formatHour` / `formatHourRange` / `describeStopWeather` are not exported.

- [ ] **Step 3: Implement**

In `app/lib/weather/weatherDisplay.js`:

1. Add near the top, after `const WET_CONDITIONS = …`:

```js
export const RAIN_ADVICE = "Plan indoor stops or bring rain gear.";

/** The server's hourly summary covers 06:00 up to 22:00 local. */
const DAYTIME_START_HOUR = 6;
const DRY_DAYTIME_TEXT = "no rain expected from 6 AM to 10 PM";
/** A wet spell this many hours or longer reads "on and off", not as one part of the day. */
const ON_AND_OFF_HOURS = 9;

const WET_WORDS = { DRIZZLE: "drizzle", RAIN: "rain", HEAVY_RAIN: "heavy rain", THUNDERSTORM: "thunderstorms" };
const SHORT_WET_WORDS = { DRIZZLE: "drizzle", RAIN: "rain", HEAVY_RAIN: "heavy rain", THUNDERSTORM: "storms" };
const WINDOW_NOUNS = { DRIZZLE: "drizzle", RAIN: "rain", HEAVY_RAIN: "rain", THUNDERSTORM: "storm" };
/** A stop counts toward the wet window when its outlook is at least the window's band. */
const OUTLOOK_RANK = { DRY: 0, SHOWERS: 1, RAIN: 2, STORM: 3 };
const WINDOW_RANK = { DRIZZLE: 1, RAIN: 2, HEAVY_RAIN: 2, THUNDERSTORM: 3 };

const STOP_OUTLOOKS = {
  DRY: { label: "Likely dry", condition: "CLEAR", tone: "dry" },
  SHOWERS: { label: "Light rain possible", condition: "DRIZZLE", tone: "wet" },
  RAIN: { label: "Rain likely", condition: "RAIN", tone: "wet" },
  STORM: { label: "Storms likely", condition: "THUNDERSTORM", tone: "storm" },
};
```

2. In `getWeatherAdvice`, replace the literal `"Plan indoor stops or bring rain gear."` with `RAIN_ADVICE`.

3. Add after `capitalize`:

```js
/** 0-23 → "12 AM", "2 PM". */
export function formatHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}

/** "2–8 PM" inside one half of the day, "11 AM–2 PM" across noon. `toHour` is exclusive. */
export function formatHourRange(fromHour, toHour) {
  const from = formatHour(fromHour);
  const to = formatHour(toHour);
  return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
}

function partOfDay(fromHour) {
  if (fromHour < 12) return { long: "Morning", short: "AM" };
  if (fromHour < 17) return { long: "Afternoon", short: "PM" };
  return { long: "Evening", short: "evening" };
}

function countStopsInWindow(hourly) {
  const rank = WINDOW_RANK[hourly.wetWindow?.condition];
  if (!rank || !Array.isArray(hourly.stops)) return 0;
  return hourly.stops.filter((stop) => (OUTLOOK_RANK[stop?.outlook] ?? 0) >= rank).length;
}
```

4. Replace the whole existing `describeDayWeather` function with these three functions. `describeWholeDay` is the old body, unchanged apart from taking `weather` directly:

```js
/**
 * Display model for one day, or null when there is nothing to show: no date,
 * no located stops, a past date, or the provider was unavailable.
 */
export function describeDayWeather(entry) {
  if (!entry || entry.status !== "OK" || !entry.weather) return null;
  const weather = entry.weather;
  // Hourly timing exists only for forecast days; typical (past-years) days never use it.
  if (weather.kind !== "TYPICAL" && entry.hourly) return describeTimedDay(weather, entry.hourly);
  return describeWholeDay(weather);
}

function describeWholeDay(weather) {
  const label = WEATHER_CONDITION_LABELS[weather.condition] ?? WEATHER_CONDITION_LABELS.UNKNOWN;
  const temperature = formatTemperatureRange(weather);
  const isTypical = weather.kind === "TYPICAL";
  const longRain = rainText(weather, true);
  const sentence = [label, temperature, longRain].filter(Boolean).join(", ");

  return {
    condition: weather.condition,
    label,
    temperature,
    rain: capitalize(longRain),
    isTypical,
    isWet: isWetWeather(weather),
    compactText: [temperature, rainText(weather, false)].filter(Boolean).join(" · "),
    ariaLabel: isTypical ? `Typical weather: ${sentence}` : `Forecast: ${sentence}`,
    advice: getWeatherAdvice(weather),
    pdfText: isTypical ? `Typical weather (past years): ${sentence}` : `Weather forecast: ${sentence}`,
  };
}

/** A forecast day with hourly timing: say WHEN the rain comes, not just the day's worst hour. */
function describeTimedDay(weather, hourly) {
  const temperature = formatTemperatureRange(weather);
  const otherAdvice = getWeatherAdvice(weather).filter((tip) => tip !== RAIN_ADVICE);
  const window = hourly.wetWindow;

  if (!window || !WET_WORDS[window.condition]) {
    // The daily code can still be wet from night rain; the daytime is what travelers see.
    const dailyIsWet = WET_CONDITIONS.has(weather.condition);
    const condition = dailyIsWet ? "CLOUDY" : weather.condition;
    const label = dailyIsWet ? "Mostly dry" : WEATHER_CONDITION_LABELS[condition] ?? WEATHER_CONDITION_LABELS.UNKNOWN;
    const sentence = [label, temperature, DRY_DAYTIME_TEXT].filter(Boolean).join(", ");
    return {
      condition,
      label,
      temperature,
      rain: capitalize(DRY_DAYTIME_TEXT),
      isTypical: false,
      isWet: false,
      compactText: [temperature, "dry"].filter(Boolean).join(" · "),
      ariaLabel: `Forecast: ${sentence}`,
      advice: otherAdvice,
      pdfText: `Weather forecast: ${sentence}`,
    };
  }

  const onAndOff = window.toHour - window.fromHour >= ON_AND_OFF_HOURS;
  const part = partOfDay(window.fromHour);
  const range = formatHourRange(window.fromHour, window.toHour);
  const label = onAndOff
    ? `${capitalize(WET_WORDS[window.condition])} on and off, ${range}`
    : `${part.long} ${WET_WORDS[window.condition]}, ${range}`;
  const shortTiming = onAndOff
    ? `${SHORT_WET_WORDS[window.condition]} on and off`
    : `${part.short} ${SHORT_WET_WORDS[window.condition]}`;

  const first = hourly.firstWetHour;
  const details = [];
  if (isNumber(first) && first >= 12) details.push("dry morning");
  else if (isNumber(first) && first > DAYTIME_START_HOUR) details.push(`dry until ${formatHour(first)}`);
  if (isNumber(weather.precipitationMm) && weather.precipitationMm >= 1) {
    details.push(`about ${Math.round(weather.precipitationMm)} mm of rain`);
  }
  const atRisk = countStopsInWindow(hourly);
  const stopsText =
    atRisk > 0 ? `${atRisk} ${atRisk === 1 ? "stop falls" : "stops fall"} in the ${WINDOW_NOUNS[window.condition]} window` : "";

  const sentence = [label, temperature, ...details].filter(Boolean).join(", ");
  return {
    condition: window.condition,
    label,
    temperature,
    // The stop count is for the screen, next to the stops; the PDF tags each stop instead.
    rain: capitalize([...details, stopsText].filter(Boolean).join(" · ")),
    isTypical: false,
    isWet: true,
    compactText: [temperature, shortTiming].filter(Boolean).join(" · "),
    ariaLabel: `Forecast: ${sentence}`,
    advice: [isNumber(first) && first >= 9 ? `Put outdoor stops before ${formatHour(first)}.` : RAIN_ADVICE, ...otherAdvice],
    pdfText: `Weather forecast: ${sentence}`,
  };
}

/** One stop's weather from its day's hourly summary, or null when there is none. */
export function describeStopWeather(entry, itemId) {
  if (!entry || entry.status !== "OK" || !itemId) return null;
  const stops = Array.isArray(entry.hourly?.stops) ? entry.hourly.stops : [];
  const stop = stops.find((candidate) => candidate?.itemId === itemId);
  const outlook = stop ? STOP_OUTLOOKS[stop.outlook] : null;
  if (!outlook) return null;

  const chance =
    stop.outlook !== "DRY" && isNumber(stop.maxPrecipitationProbabilityPct)
      ? `up to ${stop.maxPrecipitationProbabilityPct}% chance of rain`
      : "";
  return {
    outlook: stop.outlook,
    label: outlook.label,
    condition: outlook.condition,
    tone: outlook.tone,
    ariaLabel: `Weather during this stop: ${[outlook.label, chance].filter(Boolean).join(", ")}`,
    pdfText: chance ? `${outlook.label} (${chance})` : outlook.label,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/weather-display.test.js tests/weather-components.test.jsx tests/pdf-weather.test.js tests/share-page-weather.test.jsx tests/client-itinerary-weather.test.jsx`
Expected: PASS. Entries without `hourly` render exactly as before.

- [ ] **Step 5: Commit**

```bash
git add app/lib/weather/weatherDisplay.js tests/weather-display.test.js
git commit -m "feat(weather): describe when the rain falls and each stop's weather"
```

---

## Task 9: `StopWeatherTag` component (client)

**Files:**
- Create: `Voyage-Client/app/components/weather/StopWeatherTag.jsx`
- Test: `Voyage-Client/tests/stop-weather-tag.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/stop-weather-tag.test.jsx`:

```jsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/components/icons/index.js", () => {
  const Icon = () => null;
  const isIcon = (name) => typeof name === "string" && name !== "then";
  return new Proxy(
    { __esModule: true },
    {
      get: (target, name) => (name in target ? target[name] : isIcon(name) ? Icon : undefined),
      has: (target, name) => name in target || isIcon(name),
    },
  );
});
vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
vi.mock("../app/components/trip-dashboard/pages/CommentsPanel.jsx", () => ({ default: () => null }));

import StopWeatherTag from "../app/components/weather/StopWeatherTag.jsx";
import ItineraryDayView from "../app/components/trip-dashboard/pages/ItineraryDayView.jsx";
import CompactPlaceCard from "../app/components/trip-dashboard/mobile/CompactPlaceCard.jsx";

const dayWeather = {
  dayId: "day-1",
  dayNumber: 1,
  date: "2026-10-08",
  status: "OK",
  weather: {
    kind: "FORECAST",
    condition: "THUNDERSTORM",
    temperatureMinC: 15.5,
    temperatureMaxC: 23.6,
    precipitationProbabilityPct: 99,
    precipitationMm: 19.3,
  },
  hourly: {
    firstWetHour: 11,
    wetWindow: { condition: "THUNDERSTORM", fromHour: 14, toHour: 20 },
    stops: [
      { itemId: "s1", outlook: "DRY", maxPrecipitationProbabilityPct: 45 },
      { itemId: "s3", outlook: "STORM", maxPrecipitationProbabilityPct: 99 },
    ],
  },
};

const days = [
  {
    id: "day-1",
    dayNumber: 1,
    title: "Art, Views, and Delights",
    items: [
      { id: "s1", title: "BenCab Museum", type: "ACTIVITY", startTime: "09:00", endTime: "11:00" },
      { id: "s3", title: "Burnham Park", type: "ACTIVITY", startTime: "14:00", endTime: "16:30" },
    ],
  },
];

describe("StopWeatherTag", () => {
  it("shows the stop's outlook with a full sentence for screen readers", () => {
    render(<StopWeatherTag entry={dayWeather} itemId="s3" />);

    expect(screen.getByText("Storms likely")).toBeInTheDocument();
    expect(screen.getByText("Weather during this stop: Storms likely, up to 99% chance of rain")).toHaveClass("sr-only");
  });

  it("renders nothing without hourly data for the stop", () => {
    const { container } = render(<StopWeatherTag entry={dayWeather} itemId="unknown" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("stop weather on the itinerary", () => {
  it("tags each stop in the desktop day view and counts the stops in the storm window", () => {
    render(
      <ItineraryDayView
        agencyId="ag-1"
        selectedTripId="t1"
        selectedItineraryId="itin-1"
        fullItinerary={{ id: "itin-1", days }}
        safeDays={days}
        selectedDay={days[0]}
        selectedDayIndex={0}
        selectedDayMapItems={[]}
        activeStopIndex={-1}
        setActiveStopIndex={vi.fn()}
        tripStart={null}
        isLoadingItinerary={false}
        itineraryError={null}
        showCommentsPanel={false}
        setShowCommentsPanel={vi.fn()}
        theme="light"
        dayWeather={dayWeather}
      />,
    );

    expect(screen.getByText("Likely dry")).toBeInTheDocument();
    expect(screen.getByText("Storms likely")).toBeInTheDocument();
    expect(screen.getByText("Dry until 11 AM · about 19 mm of rain · 1 stop falls in the storm window")).toBeInTheDocument();
  });

  it("tags the stop inside the mobile card's button", () => {
    render(<CompactPlaceCard item={days[0].items[1]} dayWeather={dayWeather} />);

    expect(within(screen.getByRole("button")).getByText("Storms likely")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/stop-weather-tag.test.jsx`
Expected: FAIL. Cannot resolve `StopWeatherTag.jsx`.

- [ ] **Step 3: Create the component**

Create `app/components/weather/StopWeatherTag.jsx`:

```jsx
import WeatherIcon from "./WeatherIcon.jsx";
import { describeStopWeather } from "../../lib/weather/weatherDisplay.js";

// The accessibility badges' treatments: dry reads positive, storms a caution (never an alarm).
// The storm tone's light fill and dark text are self-contained, so it reads the same in both themes.
const TONES = {
  dry: "border-emerald-700/25 bg-emerald-50 text-emerald-900 dark:border-emerald-300/25 dark:bg-emerald-400/10 dark:text-emerald-100",
  wet: "border-sky-700/25 bg-sky-50 text-sky-900 dark:border-sky-300/25 dark:bg-sky-400/10 dark:text-sky-100",
  storm: "border-amber-700/30 bg-amber-100 text-amber-950",
};

/**
 * The weather during one stop, from its day's hourly forecast. Spans only, so it
 * can sit inside the mobile card's button. Renders nothing without hourly data.
 */
export default function StopWeatherTag({ entry, itemId, className = "" }) {
  const display = describeStopWeather(entry, itemId);
  if (!display) return null;

  return (
    <span
      title={display.ariaLabel}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[0.7rem] font-semibold leading-tight ${TONES[display.tone] ?? TONES.wet} ${className}`.trim()}
    >
      <WeatherIcon condition={display.condition} size={12} className="flex-shrink-0" />
      <span className="sr-only">{display.ariaLabel}</span>
      <span aria-hidden="true" className="truncate">
        {display.label}
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Run the component tests**

Run: `npx vitest run --pool=threads tests/stop-weather-tag.test.jsx -t "StopWeatherTag"`
Expected: the 2 `StopWeatherTag` tests PASS. The "on the itinerary" tests still fail until Task 10.

- [ ] **Step 5: Go straight to Task 10, then commit both together** (see Task 10, Step 5).

---

## Task 10: Tags on the desktop day view and mobile cards (client)

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ItineraryDayView.jsx:12-14` and `:139-142`
- Modify: `Voyage-Client/app/components/trip-dashboard/mobile/CompactPlaceCard.jsx`
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ClientItineraryPage.jsx:740-743`
- Test: `Voyage-Client/tests/stop-weather-tag.test.jsx` (from Task 9)

- [ ] **Step 1: Desktop: tag beside the time pill**

In `ItineraryDayView.jsx`, add the import after `import DayWeatherSummary …`:

```jsx
import StopWeatherTag from "../../weather/StopWeatherTag.jsx";
```

Replace:

```jsx
                        <span className="px-2.5 py-1 rounded-full bg-secondary/10 text-secondary text-[0.7rem] font-black tracking-tight">
                          {timeLabel || "Time pending"}
                        </span>
```

with:

```jsx
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="px-2.5 py-1 rounded-full bg-secondary/10 text-secondary text-[0.7rem] font-black tracking-tight">
                            {timeLabel || "Time pending"}
                          </span>
                          <StopWeatherTag entry={dayWeather} itemId={item.id} />
                        </div>
```

(`dayWeather` is already a prop of `ItineraryDayView`, defaulting to `null`.)

- [ ] **Step 2: Mobile: `dayWeather` prop on `CompactPlaceCard`**

In `CompactPlaceCard.jsx`:
- add the import:

```jsx
import StopWeatherTag from "../../weather/StopWeatherTag.jsx";
```

- add the prop after `onSelect,`:

```jsx
  // The day's weather entry; the card shows this stop's slice of it.
  dayWeather = null,
```

- right after the `{timeLabel && ( … )}` block inside the info column, add:

```jsx
        <StopWeatherTag entry={dayWeather} itemId={item?.id} className="self-start" />
```

In `ClientItineraryPage.jsx`, add to the mobile `<CompactPlaceCard …>` props, after `isSelected={activeStopIndex === iIdx}`:

```jsx
                              dayWeather={itineraryWeather.byDayId.get(selectedDay.id) ?? null}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run --pool=threads tests/stop-weather-tag.test.jsx tests/itinerary-day-view-editing.test.jsx tests/client-itinerary-weather.test.jsx`
Expected: PASS.

- [ ] **Step 4: Check the layout in the browser**

The dev servers usually run already (client :3000, server :4000). If not, start them with the Browser pane's `preview_start`, not Bash. Open an itinerary whose trip has a start date within 16 days.

Local trips have no dates. Before writing a start date into the local DB, ask the user, and only change a test trip. If you can't get a dated trip, check this on staging after deploy instead.

Confirm all of these:
- each stop's time pill has a tag beside it and wraps on narrow widths;
- the day summary reads "Forecast: {Morning|Afternoon|Evening} …, {range}";
- the mobile list shows the tag under the time;
- both themes are legible.

- [ ] **Step 5: Commit (Tasks 9 + 10)**

```bash
git add app/components/weather/StopWeatherTag.jsx app/components/trip-dashboard/pages/ItineraryDayView.jsx app/components/trip-dashboard/mobile/CompactPlaceCard.jsx app/components/trip-dashboard/pages/ClientItineraryPage.jsx tests/stop-weather-tag.test.jsx
git commit -m "feat(itinerary): tag each stop with the weather during its time slot"
```

---

## Task 11: Tags on the public share page (client)

**Files:**
- Modify: `Voyage-Client/app/itinerary/view/[token]/components/ShareStopCard.jsx`
- Modify: `Voyage-Client/app/itinerary/view/[token]/page.jsx:711-716`
- Test: `Voyage-Client/tests/share-page-weather.test.jsx`

- [ ] **Step 1: Write the failing test**

Add inside `describe("public share weather", …)` in `tests/share-page-weather.test.jsx`:

```jsx
  it("tags each timed stop with the weather during it", async () => {
    const base = await api.fetchPublicItinerary();
    api.fetchPublicItinerary.mockResolvedValue({
      ...base,
      itinerary: {
        ...base.itinerary,
        days: [
          {
            ...base.itinerary.days[0],
            items: [
              { id: "item-1", type: "ACTIVITY", title: "Burnham Park", startTime: "14:00", endTime: "16:00", placeSnapshot: null },
            ],
          },
        ],
      },
    });
    api.fetchSharedItineraryWeather.mockResolvedValue({
      weather: {
        provider: "open-meteo",
        attribution: { text: "Weather data by Open-Meteo.com", url: "https://open-meteo.com/" },
        days: [
          {
            dayId: "day-1",
            dayNumber: 1,
            date: "2026-10-10",
            status: "OK",
            weather: { kind: "FORECAST", condition: "THUNDERSTORM", temperatureMinC: 16, temperatureMaxC: 24, precipitationProbabilityPct: 99 },
            hourly: {
              firstWetHour: 14,
              wetWindow: { condition: "THUNDERSTORM", fromHour: 14, toHour: 20 },
              stops: [{ itemId: "item-1", outlook: "STORM", maxPrecipitationProbabilityPct: 99 }],
            },
          },
        ],
      },
    });

    render(<PublicItineraryPage />);

    expect(await screen.findByText("Storms likely")).toBeInTheDocument();
    expect(screen.getByText("16–24°C · PM storms")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/share-page-weather.test.jsx`
Expected: FAIL on the new test. No "Storms likely" appears; the chip assertion passes once the tag renders.

- [ ] **Step 3: Implement**

In `ShareStopCard.jsx`:
- add the import:

```jsx
import StopWeatherTag from "../../../../components/weather/StopWeatherTag.jsx";
```

- add `dayWeather = null` to the props: `export default function ShareStopCard({ item, isActive = false, timeLabel = "", icon = null, actions = null, dayWeather = null, onHoverChange, children })`
- replace:

```jsx
          {timeLabel ? (
            <span className="rounded-pill bg-secondary/10 px-2.5 py-1 text-[0.72rem] font-bold text-secondary-strong">{timeLabel}</span>
          ) : (
            <span />
          )}
```

with:

```jsx
          {timeLabel ? (
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="rounded-pill bg-secondary/10 px-2.5 py-1 text-[0.72rem] font-bold text-secondary-strong">{timeLabel}</span>
              <StopWeatherTag entry={dayWeather} itemId={item.id} />
            </span>
          ) : (
            <span />
          )}
```

(A stop without a time label has no `startTime`, so it never has stop weather.)

In `app/itinerary/view/[token]/page.jsx`, add to the `<ShareStopCard …>` props, after `timeLabel={…}`:

```jsx
                        dayWeather={shareWeather.byDayId.get(day.id) ?? null}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/share-page-weather.test.jsx tests/share-page-layout.test.jsx tests/share-page-accessibility.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/itinerary/view/[token]/components/ShareStopCard.jsx" "app/itinerary/view/[token]/page.jsx" tests/share-page-weather.test.jsx
git commit -m "feat(share): tag each shared stop with the weather during it"
```

---

## Task 12: Stop weather in the PDF (client)

**Files:**
- Modify: `Voyage-Client/app/lib/pdfExport.js:2` and the item loop (`const timeStr = buildTimeLabel(item);`)
- Test: `Voyage-Client/tests/pdf-weather.test.js`

- [ ] **Step 1: Write the failing test**

Add inside `describe("pdf export weather", …)` in `tests/pdf-weather.test.js`:

```js
  it("prints the timed forecast and each stop's weather after its time", async () => {
    await generateItineraryPdf({
      title: "Trip",
      summary: "",
      days: [
        {
          ...dayWith({
            status: "OK",
            weather: { kind: "FORECAST", condition: "THUNDERSTORM", temperatureMinC: 15.5, temperatureMaxC: 23.6, precipitationProbabilityPct: 99, precipitationMm: 19.3 },
            hourly: {
              firstWetHour: 11,
              wetWindow: { condition: "THUNDERSTORM", fromHour: 14, toHour: 20 },
              stops: [{ itemId: "s3", outlook: "STORM", maxPrecipitationProbabilityPct: 99 }],
            },
          }),
          items: [
            { id: "s3", title: "Burnham Park", startTime: "14:00", endTime: "16:30" },
            { id: "s9", title: "Dinner", startTime: "19:00" },
          ],
        },
      ],
    });

    const printed = state.instance.texts.join("").replace(/\n/g, "");
    expect(printed).toContain("Weather forecast: Afternoon thunderstorms, 2–8 PM, 16–24°C, dry until 11 AM, about 19 mm of rain");
    expect(printed).toContain("2:00 PM – 4:30 PM  ·  Storms likely (up to 99% chance of rain)");
    // A stop the summary does not cover prints its time alone.
    expect(state.instance.texts).toContain("7:00 PM");
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/pdf-weather.test.js`
Expected: FAIL on the stop line (the timed day line already passes after Task 8).

- [ ] **Step 3: Implement**

In `app/lib/pdfExport.js`:
- line 2 becomes:

```js
import { describeDayWeather, describeStopWeather } from "./weather/weatherDisplay.js";
```

- in the item loop, replace:

```js
      // Time label
      const timeStr = buildTimeLabel(item);
```

with:

```js
      // Time label, followed by the weather during the stop when the day has hourly timing.
      // WinAnsi-safe: "·", "–" and "%" all print in jsPDF's standard fonts.
      const timeLabel = buildTimeLabel(item);
      const stopWeatherText = timeLabel ? describeStopWeather(day.weatherEntry, item.id)?.pdfText ?? "" : "";
      const timeStr = stopWeatherText ? `${timeLabel}  ·  ${stopWeatherText}` : timeLabel;
```

(`timeStr` is still the one line drawn at 8.5pt below. It stays well under the content width, so no wrapping or extra height is needed.)

- [ ] **Step 4: Run the PDF tests**

Run: `npx vitest run --pool=threads tests/pdf-weather.test.js tests/pdf-accessibility.test.js tests/pdf-place-status.test.js tests/pdf-delivery.test.js tests/share-page-pdf.test.jsx tests/client-itinerary-pdf.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/pdfExport.js tests/pdf-weather.test.js
git commit -m "feat(pdf): print each stop's weather beside its time"
```

---

## Task 13: Client checkpoint + QA

- [ ] **Step 1: Full suite + build**

Run (in `Voyage-Client`): `npx vitest run --pool=threads`
Expected: only the known baseline (8 files / 1 test, `agent-command-center-places`); no failures in weather, PDF, share or itinerary files.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 2: Manual QA checklist** (needs a trip with a start date within 16 days; see Task 10 Step 4 about dates)

1. Desktop day view:
   - the summary headline names a part of the day and an hour range;
   - the detail line says "Dry until …" or "Dry morning", the mm, and the stops in the window;
   - the advice says "Put outdoor stops before …".
2. Each timed stop shows one tag. Stops without a time show none.
3. Day-strip chip shows `"{temp} · PM storms"` (or AM/evening/on and off/dry).
4. Mobile: summary + tag under each card's time; the tag does not break the card's button.
5. Edit a stop's time (unlocked trip) and check that its tag updates after the save.
6. Share link: chip + tags render; the page has no day summary card (unchanged).
7. PDF (dashboard and share page): day line reads "Weather forecast: Afternoon …"; stop lines read "2:00 PM – 4:30 PM  ·  Storms likely (…)".
8. A trip 3+ weeks out still shows "Typical weather" with no tags.
9. Dark and light themes: all three tag tones are legible.
10. Ask the agent to plan a dated trip within 16 days. The weather tool result in the run should include `timing`.

- [ ] **Step 3: Report**

Summarize the results to the user: the test counts against the baseline, the build status, and any QA items that could not be checked (for example, no dated local trip). Leave pushing and merging to the user.

## Post-review changes (2026-10-06)

Code-review fixes applied after the tasks above shipped. They refine D1, D4, D5 and the agent tool; the task steps above are left as written.

- **Rounded hourly point.** The hourly request uses `roundPoint()` (two decimals), the same point as the daily lookup, in `itineraryWeather.ts` and `weatherTools.ts`. Raw four-decimal points resolved to a different Open-Meteo grid cell (about 9 km apart for Baguio) and made the cached entry depend on whichever point arrived first.
- **Snow is not dry.** `StopRainOutlook` gains `"SNOW"`, ranked `DRY < SHOWERS < RAIN < SNOW < STORM`. The day's wet window and a stop's outlook can now be snow, and the agent line says "snow". `isWetCondition` is unchanged; `hourlyWeather.ts` uses its own `isPrecipitation` helper.
- **Whole wet spell.** `HourlyDayOutlook` gains `lastWetHour` (last daytime hour with precipitation, inclusive; `null` when dry). The agent line appends `; wet until {hour}` when the spell outlasts the worst weather, e.g. "dry until 11 AM; thunderstorms 2 PM-8 PM; wet until 9 PM". The prompt now says to put outdoor stops "before the first wet hour or after the wet spell ends" and covered stops "inside the wet hours it names".
- **Missing codes are not "dry".** An hourly row with no weather code is ignored: it does not cover a stop and adds no rain chance. A stop entirely in such rows gets no entry, and a day with no coded daytime row has no outlook (`summarizeHourlyDay` returns `null`), so it keeps its daily display as D2 says.
- **Stops ending at midnight.** An end time of "24:00" is the end of the day (hours up to 23 count). A start must still be before 24:00, and a late stop with no end is capped at midnight.
- **rainRisk follows the timing.** In `weather_forecast`, a forecast day with an hourly outlook sets `rainRisk` from `wetWindow !== null`, so a night-only storm no longer reads `rainRisk: true` beside "dry from 6 AM to 10 PM". Days without an outlook keep the daily rule.
- **DST note.** Open-Meteo applies one fixed UTC offset to the whole 16-day series, so after a clock change inside the window the rows are one hour off the wall clock (the daily rows share the skew). Accepted and documented on `RawHourlyWeather`.
- **Client follow-up.** The client needs `SNOW` support (labels and tone for the new outlook and window condition) and must tolerate the new `lastWetHour` field. This is handled in a separate client change.
