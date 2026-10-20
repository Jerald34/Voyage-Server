import { ApiError } from "../../http/errors";
import type { TripPreview } from "./dashboardTypes";
import { tripPreviewRepository, type RawTripPreview, type TripPreviewRepository } from "./tripPreviewRepository";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Shapes one trip's raw rows into the trip panel's payload. */
export function buildTripPreview(raw: RawTripPreview): TripPreview {
  if (!raw.trip) {
    throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
  }
  const stops = new Map(raw.itemTitles.map((item) => [item.id, item]));
  const shareItinerary = new Map(raw.shares.map((s) => [s.id, s.itineraryId]));
  // A comment's itemId comes from the public share page unchecked, so a stop
  // is only named when it is in the itinerary the comment's own link shows.
  const stopTitle = (comment: RawTripPreview["comments"][number]): string | null => {
    const stop = comment.itemId ? stops.get(comment.itemId) : undefined;
    return stop && stop.itineraryId === shareItinerary.get(comment.shareId) ? stop.title : null;
  };
  // Shares arrive newest first: the newest live link, else the newest of all.
  const share = raw.shares.find((s) => s.revokedAt === null) ?? raw.shares[0] ?? null;

  return {
    trip: {
      id: raw.trip.id,
      title: raw.trip.title,
      status: raw.trip.status,
      clientName: raw.trip.clientName,
      startDate: iso(raw.trip.startDate),
      endDate: iso(raw.trip.endDate),
      travelerCount: raw.trip.travelerCount,
      destinationSummary: raw.trip.destinationSummary
    },
    share: share
      ? {
          id: share.id,
          clientName: share.clientName,
          viewCount: share.viewCount,
          lastViewedAt: iso(share.lastViewedAt),
          expiresAt: iso(share.expiresAt),
          revokedAt: iso(share.revokedAt),
          proposalRating: share.proposalRating,
          createdAt: share.createdAt.toISOString()
        }
      : null,
    // Fields are listed one by one so nothing else on the row (such as the
    // client's email) can reach the response.
    comments: raw.comments.map((comment) => ({
      id: comment.id,
      shareId: comment.shareId,
      authorName: comment.authorName,
      content: comment.content,
      status: comment.status,
      dayNumber: comment.dayNumber,
      itemId: comment.itemId,
      itemTitle: stopTitle(comment),
      agencyReply: comment.agencyReply,
      agencyRepliedAt: iso(comment.agencyRepliedAt),
      createdAt: comment.createdAt.toISOString()
    }))
  };
}

export function createTripPreviewService(deps: { repository: TripPreviewRepository }) {
  return {
    async getTripPreview(agencyId: string, tripId: string): Promise<TripPreview> {
      return buildTripPreview(await deps.repository.fetchTripPreview(agencyId, tripId));
    }
  };
}

export const tripPreviewService = createTripPreviewService({ repository: tripPreviewRepository });
