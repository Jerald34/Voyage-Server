import type { RawDashboardData } from "./dashboardRepository";
import type { ClientCommentRow, ClientComments } from "./dashboardTypes";

/**
 * The dashboard's "Client comments" card: comments still waiting for the
 * agency (the same rule as the "Needs you today" rows) and the ones answered
 * recently, so an agent can look back at what was asked and what they said.
 * Pure: the service hands in the rows and the clock.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How far back the Answered list reaches. */
export const ANSWERED_WINDOW_DAYS = 30;
/** Most rows each list sends. */
export const WAITING_LIMIT = 50;
export const ANSWERED_LIMIT = 20;
const EXCERPT_LENGTH = 280;
/** Longest agency reply a card row carries; the trip panel has the whole text. */
const REPLY_LENGTH = 280;

export type ClientCommentInputs = {
  trips: RawDashboardData["trips"];
  shares: RawDashboardData["shares"];
  comments: RawDashboardData["comments"];
  itemTitles?: RawDashboardData["itemTitles"];
  now: Date;
  /** Staff view: only comments on these trips. */
  tripIds?: Set<string>;
};

export function selectClientComments(inputs: ClientCommentInputs): ClientComments {
  const tripIndex = new Map(inputs.trips.map((trip) => [trip.id, trip]));
  const shareIndex = new Map(inputs.shares.map((share) => [share.id, share]));
  const stops = new Map((inputs.itemTitles ?? []).map((item) => [item.id, item]));
  const answeredCutoff = inputs.now.getTime() - ANSWERED_WINDOW_DAYS * MS_PER_DAY;

  // Each row travels with the time it sorts by (asked at / replied at).
  const waiting: SortedRow[] = [];
  const answered: SortedRow[] = [];

  for (const comment of inputs.comments) {
    const share = shareIndex.get(comment.shareId);
    if (!share?.tripId) continue;
    if (inputs.tripIds && !inputs.tripIds.has(share.tripId)) continue;
    const trip = tripIndex.get(share.tripId);
    if (!trip) continue;

    const row: ClientCommentRow = {
      id: comment.id,
      shareId: comment.shareId,
      tripId: trip.id,
      tripTitle: trip.title,
      clientName: share.clientName ?? trip.clientName ?? null,
      authorName: comment.authorName,
      excerpt: comment.content.slice(0, EXCERPT_LENGTH),
      dayNumber: comment.dayNumber,
      itemTitle: stopTitle(comment.itemId ? stops.get(comment.itemId) : undefined, share.itineraryId),
      createdAt: comment.createdAt.toISOString(),
      agencyReply: comment.agencyReply === null ? null : shortenReply(comment.agencyReply),
      agencyRepliedAt: comment.agencyRepliedAt ? comment.agencyRepliedAt.toISOString() : null
    };

    if (comment.agencyRepliedAt === null) {
      if (comment.status === "PENDING") waiting.push({ row, time: comment.createdAt.getTime() });
    } else if (comment.agencyRepliedAt.getTime() >= answeredCutoff) {
      answered.push({ row, time: comment.agencyRepliedAt.getTime() });
    }
  }

  // Equal times fall back to the id, so which rows survive the cap never
  // depends on the order the database returned them in.
  waiting.sort((a, b) => a.time - b.time || compareIds(a.row.id, b.row.id));
  answered.sort((a, b) => b.time - a.time || compareIds(a.row.id, b.row.id));
  return {
    waiting: waiting.slice(0, WAITING_LIMIT).map((entry) => entry.row),
    answered: answered.slice(0, ANSWERED_LIMIT).map((entry) => entry.row)
  };
}

type SortedRow = { row: ClientCommentRow; time: number };

/**
 * A comment's itemId comes from the public share page unchecked, so the stop
 * is only named when it sits in the itinerary the comment's own link shows.
 */
function stopTitle(stop: { title: string; itineraryId: string } | undefined, shareItineraryId: string): string | null {
  return stop && stop.itineraryId === shareItineraryId ? stop.title : null;
}

/** A long reply cut to REPLY_LENGTH characters with an ellipsis, by code point so an emoji is never split. */
function shortenReply(reply: string): string {
  const chars = Array.from(reply);
  return chars.length > REPLY_LENGTH ? `${chars.slice(0, REPLY_LENGTH - 1).join("").trimEnd()}…` : reply;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
