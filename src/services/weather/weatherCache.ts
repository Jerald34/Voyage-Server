import type { GeoPoint, RawDailyWeather, WeatherProvider } from "./types";

type Entry<T> = { value: Promise<T>; expiresAt: number };

/**
 * Small in-process TTL cache. Concurrent callers for one key share a single
 * request; a failed request is evicted so the next caller retries. Per-process
 * only: a restart empties it, which is fine for free public weather data.
 */
export function createTtlCache<T>(options: { ttlMs: number; maxEntries: number; now?: () => number }) {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry<T>>();

  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) return existing.value;
      if (existing) entries.delete(key);

      const value = load();
      entries.set(key, { value, expiresAt: now() + options.ttlMs });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });

      // Map iteration order is insertion order, so the first key is the oldest.
      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return value;
    },
    size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    }
  };
}

export const FORECAST_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
// Past weather does not change; a week keeps the archive calls rare.
export const HISTORY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

function cellKey(location: GeoPoint) {
  return `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
}

/** Wraps a provider so repeated reads for the same place and range reuse one response. */
export function createCachedWeatherProvider(
  provider: WeatherProvider,
  options: { now?: () => number } = {}
): WeatherProvider {
  const forecasts = createTtlCache<RawDailyWeather[]>({
    ttlMs: FORECAST_CACHE_TTL_MS,
    maxEntries: MAX_CACHE_ENTRIES,
    now: options.now
  });
  const history = createTtlCache<RawDailyWeather[]>({
    ttlMs: HISTORY_CACHE_TTL_MS,
    maxEntries: MAX_CACHE_ENTRIES,
    now: options.now
  });

  return {
    name: provider.name,
    getDailyForecast(location) {
      return forecasts.get(cellKey(location), () => provider.getDailyForecast(location));
    },
    getDailyHistory(location, startDate, endDate) {
      return history.get(`${cellKey(location)}:${startDate}:${endDate}`, () =>
        provider.getDailyHistory(location, startDate, endDate)
      );
    }
  };
}
