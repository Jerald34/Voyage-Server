import { ApiError } from "../../http/errors";
import type { PersonalRepository } from "./personalRepository";

export function createPersonalService(options: { repository: PersonalRepository }) {
  return {
    async listItineraries(userId: string) {
      return options.repository.listItinerariesForUser(userId);
    },

    async getItinerary(userId: string, itineraryId: string) {
      const itinerary = await options.repository.findItineraryForUser(userId, itineraryId);
      if (!itinerary) {
        throw new ApiError(404, "PERSONAL_ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      return itinerary;
    },

    async createItinerary(userId: string, input: { title: string; summary?: string }) {
      const title = input.title.trim();
      if (!title) {
        throw new ApiError(400, "PERSONAL_ITINERARY_TITLE_REQUIRED", "Itinerary title is required.");
      }
      return options.repository.createItineraryForUser({
        userId,
        title,
        summary: input.summary?.trim() ?? undefined
      });
    },

    async updateItinerary(
      userId: string,
      itineraryId: string,
      data: { title?: string; summary?: string | null }
    ) {
      const patch: { title?: string; summary?: string | null } = {};
      if (data.title !== undefined) {
        const t = data.title.trim();
        if (!t) throw new ApiError(400, "PERSONAL_ITINERARY_TITLE_REQUIRED", "Itinerary title is required.");
        patch.title = t;
      }
      if (data.summary !== undefined) {
        patch.summary = data.summary === null ? null : data.summary.trim();
      }
      const updated = await options.repository.updateItineraryForUser({ userId, itineraryId, data: patch });
      if (!updated) {
        throw new ApiError(404, "PERSONAL_ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      return updated;
    },

    async deleteItinerary(userId: string, itineraryId: string) {
      const ok = await options.repository.deleteItineraryForUser(userId, itineraryId);
      if (!ok) {
        throw new ApiError(404, "PERSONAL_ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      return { deleted: true as const };
    },

    async listThreads(userId: string) {
      return options.repository.listThreadsForUser(userId);
    },

    async createThread(userId: string, title?: string) {
      return options.repository.createThreadForUser({
        userId,
        title: title?.trim() || "New thread"
      });
    },

    async createShare(
      userId: string,
      input: { itineraryId: string; recipientName?: string; recipientEmail?: string }
    ) {
      return options.repository.createShareForUserItinerary({
        userId,
        itineraryId: input.itineraryId,
        recipientName: input.recipientName,
        recipientEmail: input.recipientEmail
      });
    }
  };
}
