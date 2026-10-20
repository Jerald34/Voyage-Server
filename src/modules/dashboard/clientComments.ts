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
  const titles = new Map((inputs.itemTitles ?? []).map((item) => [item.id, item.title]));
  const answeredCutoff = inputs.now.getTime() - ANSWERED_WINDOW_DAYS * MS_PER_DAY;

  const waiting: ClientCommentRow[] = [];
  const answered: ClientCommentRow[] = [];

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
      itemTitle: comment.itemId ? titles.get(comment.itemId) ?? null : null,
      createdAt: comment.createdAt.toISOString(),
      agencyReply: comment.agencyReply,
      agencyRepliedAt: comment.agencyRepliedAt ? comment.agencyRepliedAt.toISOString() : null
    };

    if (comment.agencyRepliedAt === null) {
      if (comment.status === "PENDING") waiting.push(row);
    } else if (comment.agencyRepliedAt.getTime() >= answeredCutoff) {
      answered.push(row);
    }
  }

  waiting.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  answered.sort((a, b) => (a.agencyRepliedAt! > b.agencyRepliedAt! ? -1 : 1));
  return { waiting: waiting.slice(0, WAITING_LIMIT), answered: answered.slice(0, ANSWERED_LIMIT) };
}
