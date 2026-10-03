import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import { getWeatherProvider, type WeatherProvider } from "../../services/weather";
import {
  buildItineraryWeather,
  type ItineraryWeather,
  type WeatherDayInput
} from "../../services/weather/itineraryWeather";
import { itineraryService } from "../itineraries/itineraryService";
import { shareRepository } from "../shares/shareRepository";

export type ItineraryWeatherServiceDeps = {
  /** Must enforce agency scope (throw 404 for another agency's itinerary). */
  loadAgencyItinerary(agencyId: string, itineraryId: string): Promise<{ tripId: string | null; days: WeatherDayInput[] }>;
  loadTripStartDate(agencyId: string, tripId: string): Promise<Date | null>;
  loadShare(token: string): Promise<{
    share: { revokedAt: Date | null; expiresAt: Date | null };
    trip: { startDate: Date | null } | null;
    itinerary: { days: WeatherDayInput[] };
  } | null>;
  getProvider(): WeatherProvider | null;
  typicalYears: number;
  now?: () => Date;
};

export function createItineraryWeatherService(deps: ItineraryWeatherServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async forAgencyItinerary(agencyId: string, itineraryId: string): Promise<ItineraryWeather> {
      const itinerary = await deps.loadAgencyItinerary(agencyId, itineraryId);
      const tripStartDate = itinerary.tripId ? await deps.loadTripStartDate(agencyId, itinerary.tripId) : null;
      return buildItineraryWeather({
        days: itinerary.days,
        tripStartDate,
        provider: deps.getProvider(),
        now: now(),
        typicalYears: deps.typicalYears
      });
    },

    /**
     * Same revoked/expired rules as the share page and its comments. It reads the
     * repository directly because shareService.getShareByToken counts a view, and
     * a weather fetch is not a view.
     */
    async forShareToken(token: string): Promise<ItineraryWeather> {
      const data = await deps.loadShare(token);
      if (!data) throw new ApiError(404, "SHARE_NOT_FOUND", "Share link not found.");
      if (data.share.revokedAt !== null) {
        throw new ApiError(410, "SHARE_REVOKED", "This share link has been revoked.");
      }
      if (data.share.expiresAt !== null && data.share.expiresAt <= now()) {
        throw new ApiError(410, "SHARE_EXPIRED", "This share link has expired.");
      }
      return buildItineraryWeather({
        days: data.itinerary.days,
        tripStartDate: data.trip?.startDate ?? null,
        provider: deps.getProvider(),
        now: now(),
        typicalYears: deps.typicalYears
      });
    }
  };
}

export const itineraryWeatherService = createItineraryWeatherService({
  loadAgencyItinerary: async (agencyId, itineraryId) => {
    // Raw read (no place session): weather needs dates and coordinates only.
    const itinerary = await itineraryService.getItinerary(agencyId, itineraryId);
    return { tripId: itinerary.tripId ?? null, days: itinerary.days as WeatherDayInput[] };
  },
  loadTripStartDate: async (agencyId, tripId) => {
    const trip = await prisma.clientTrip.findFirst({
      where: { id: tripId, agencyId },
      select: { startDate: true }
    });
    return trip?.startDate ?? null;
  },
  loadShare: (token) => shareRepository.findShareByToken(token),
  getProvider: getWeatherProvider,
  typicalYears: env.WEATHER_TYPICAL_YEARS
});
