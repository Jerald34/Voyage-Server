import { describe, expect, it } from "vitest";
import {
  ANSWERED_LIMIT,
  WAITING_LIMIT,
  selectClientComments
} from "../src/modules/dashboard/clientComments";
import type { RawDashboardData } from "../src/modules/dashboard/dashboardRepository";

const NOW = new Date("2026-10-20T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

type Trip = RawDashboardData["trips"][number];
type Share = RawDashboardData["shares"][number];
type Comment = RawDashboardData["comments"][number];

const trip = (id: string, fields: Partial<Trip> = {}): Trip => ({
  id,
  title: `Trip ${id}`,
  status: "IN_REVIEW",
  createdAt: at(-10 * DAY),
  updatedAt: at(-1 * DAY),
  startDate: null,
  endDate: null,
  travelerCount: null,
  clientName: "Trip Client",
  createdByUserId: "u1",
  assignedOrganizerUserId: null,
  ...fields
});

const share = (id: string, tripId: string | null, fields: Partial<Share> = {}): Share => ({
  id,
  tripId,
  clientName: null,
  viewCount: 0,
  lastViewedAt: null,
  expiresAt: null,
  revokedAt: null,
  proposalRating: null,
  proposalRatedAt: null,
  createdAt: at(-5 * DAY),
  ...fields
});

const comment = (id: string, shareId: string, fields: Partial<Comment> = {}): Comment => ({
  id,
  shareId,
  content: `Question ${id}`,
  status: "PENDING",
  agencyRepliedAt: null,
  createdAt: at(-2 * HOUR),
  authorName: "Maria Santos",
  agencyReply: null,
  dayNumber: null,
  itemId: null,
  ...fields
});

describe("selectClientComments", () => {
  it("splits comments into waiting (oldest first) and answered (newest reply first)", () => {
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1")],
      comments: [
        comment("new", "s1", { createdAt: at(-1 * HOUR) }),
        comment("old", "s1", { createdAt: at(-5 * HOUR) }),
        comment("replied-early", "s1", { status: "ADDRESSED", agencyReply: "Yes", agencyRepliedAt: at(-3 * DAY) }),
        comment("replied-late", "s1", { status: "ADDRESSED", agencyReply: "Done", agencyRepliedAt: at(-1 * DAY) })
      ],
      now: NOW
    });

    expect(result.waiting.map((row) => row.id)).toEqual(["old", "new"]);
    expect(result.answered.map((row) => row.id)).toEqual(["replied-late", "replied-early"]);
  });

  it("describes each row with the trip, the client, the stop and the reply", () => {
    const result = selectClientComments({
      trips: [trip("t1", { title: "Kyoto Autumn Escape" })],
      shares: [share("s1", "t1", { clientName: "Santos Family" })],
      comments: [
        comment("c1", "s1", {
          content: "Is the ryokan wheelchair accessible?",
          dayNumber: 1,
          itemId: "item-1",
          status: "ADDRESSED",
          agencyReply: "Yes, it is.",
          agencyRepliedAt: at(-1 * HOUR)
        })
      ],
      itemTitles: [{ id: "item-1", title: "Ryokan check-in" }],
      now: NOW
    });

    expect(result.answered[0]).toEqual({
      id: "c1",
      shareId: "s1",
      tripId: "t1",
      tripTitle: "Kyoto Autumn Escape",
      clientName: "Santos Family",
      authorName: "Maria Santos",
      excerpt: "Is the ryokan wheelchair accessible?",
      dayNumber: 1,
      itemTitle: "Ryokan check-in",
      createdAt: at(-2 * HOUR).toISOString(),
      agencyReply: "Yes, it is.",
      agencyRepliedAt: at(-1 * HOUR).toISOString()
    });
  });

  it("falls back to the trip's client and leaves an unknown stop untitled", () => {
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1")],
      comments: [comment("c1", "s1", { itemId: "deleted-item", dayNumber: 2 })],
      itemTitles: [],
      now: NOW
    });
    expect(result.waiting[0]).toMatchObject({ clientName: "Trip Client", dayNumber: 2, itemTitle: null });
  });

  it("drops replies older than 30 days and comments without a trip", () => {
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1"), share("s-personal", null), share("s-gone", "t-deleted")],
      comments: [
        comment("stale", "s1", { status: "ADDRESSED", agencyReply: "Ok", agencyRepliedAt: at(-31 * DAY) }),
        comment("personal", "s-personal"),
        comment("orphan", "s-gone")
      ],
      now: NOW
    });
    expect(result).toEqual({ waiting: [], answered: [] });
  });

  it("keeps only the given trips for the staff view", () => {
    const result = selectClientComments({
      trips: [trip("mine"), trip("theirs")],
      shares: [share("s-mine", "mine"), share("s-theirs", "theirs")],
      comments: [comment("c-mine", "s-mine"), comment("c-theirs", "s-theirs")],
      now: NOW,
      tripIds: new Set(["mine"])
    });
    expect(result.waiting.map((row) => row.id)).toEqual(["c-mine"]);
  });

  it("caps waiting at the 50 oldest and answered at the 20 newest replies", () => {
    // Waiting arrives newest first and answered oldest first: cutting the lists
    // before sorting them would keep the wrong rows.
    const waiting = Array.from({ length: WAITING_LIMIT + 5 }, (_, i) =>
      comment(`w${String(i).padStart(2, "0")}`, "s1", { createdAt: at(-(i + 1) * HOUR) })
    );
    const answered = Array.from({ length: ANSWERED_LIMIT + 5 }, (_, i) =>
      comment(`a${String(i).padStart(2, "0")}`, "s1", {
        status: "ADDRESSED",
        agencyReply: "Ok",
        agencyRepliedAt: at(-(ANSWERED_LIMIT + 5 - i) * HOUR)
      })
    );
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1")],
      comments: [...waiting, ...answered],
      now: NOW
    });

    // w54 is the oldest comment; the five newest (w00-w04) are cut.
    expect(result.waiting.map((row) => row.id)).toEqual(
      Array.from({ length: WAITING_LIMIT }, (_, i) => `w${String(WAITING_LIMIT + 4 - i).padStart(2, "0")}`)
    );
    // a24 is the newest reply; the five oldest (a00-a04) are cut.
    expect(result.answered.map((row) => row.id)).toEqual(
      Array.from({ length: ANSWERED_LIMIT }, (_, i) => `a${String(ANSWERED_LIMIT + 4 - i).padStart(2, "0")}`)
    );
  });

  it("breaks ties on the id, so the rows kept at the cap do not depend on the input order", () => {
    const sameTime = (prefix: string, count: number, fields: Partial<Comment>) =>
      Array.from({ length: count }, (_, i) => comment(`${prefix}${String(i).padStart(2, "0")}`, "s1", fields));
    const waiting = sameTime("w", WAITING_LIMIT + 5, { createdAt: at(-3 * HOUR) });
    const answered = sameTime("a", ANSWERED_LIMIT + 5, {
      status: "ADDRESSED",
      agencyReply: "Ok",
      agencyRepliedAt: at(-1 * HOUR)
    });
    const select = (comments: Comment[]) =>
      selectClientComments({ trips: [trip("t1")], shares: [share("s1", "t1")], comments, now: NOW });

    const forward = select([...waiting, ...answered]);
    const backward = select([...waiting, ...answered].reverse());

    expect(backward).toEqual(forward);
    expect(forward.waiting.map((row) => row.id)).toEqual(waiting.slice(0, WAITING_LIMIT).map((c) => c.id));
    expect(forward.answered.map((row) => row.id)).toEqual(answered.slice(0, ANSWERED_LIMIT).map((c) => c.id));
  });

  it("leaves a seen comment with no reply out of both lists", () => {
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1")],
      comments: [comment("seen", "s1", { status: "SEEN" }), comment("pending", "s1")],
      now: NOW
    });
    expect(result.waiting.map((row) => row.id)).toEqual(["pending"]);
    expect(result.answered).toEqual([]);
  });

  it("keeps a reply exactly 30 days old and drops one a millisecond older", () => {
    const replied = (id: string, repliedAt: Date) =>
      comment(id, "s1", { status: "ADDRESSED", agencyReply: "Ok", agencyRepliedAt: repliedAt });
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1")],
      comments: [replied("on-the-line", at(-30 * DAY)), replied("just-past", at(-30 * DAY - 1))],
      now: NOW
    });
    expect(result.answered.map((row) => row.id)).toEqual(["on-the-line"]);
  });
});
