import { env } from "../../config/env";
import { createOpenMeteoProvider } from "./openMeteo";
import { createCachedWeatherProvider } from "./weatherCache";
import type { WeatherProvider } from "./types";

export * from "./types";
export { conditionFromWmoCode, isWetCondition } from "./weatherCodes";
export { createOpenMeteoProvider, weatherUnavailable } from "./openMeteo";
export { createCachedWeatherProvider } from "./weatherCache";

// Built on first use, never at import time, so importing a route module cannot
// fail or open sockets. `null` means weather is disabled.
let provider: WeatherProvider | null | undefined;

export function getWeatherProvider(): WeatherProvider | null {
  if (provider !== undefined) return provider;
  provider = env.WEATHER_PROVIDER === "open-meteo" ? createCachedWeatherProvider(createOpenMeteoProvider()) : null;
  return provider;
}

export function resetWeatherProviderForTests() {
  provider = undefined;
}
