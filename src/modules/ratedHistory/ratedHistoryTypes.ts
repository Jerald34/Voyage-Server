import { z } from "zod";
import {
  insertSelectionSchema,
  insertTargetSchema,
  insertBodySchema
} from "./ratedHistorySchemas.js";

// ── Itinerary item type ──────────────────────────────────────────────────────

export type ItineraryItemType =
  | "ACTIVITY"
  | "MEAL"
  | "TRANSFER"
  | "CHECK_IN"
  | "CHECK_OUT"
  | "FREE_TIME"
  | "NOTE";

// ── Trip summary (used in list + detail responses) ───────────────────────────

export type RatedTripSummary = {
  tripId: string;
  title: string;
  destinationSummary: string | null;
  dayCount: number;
  startDate: string | null;   // ISO date string
  endDate: string | null;     // ISO date string
  rating: number;             // TripReview.rating (≥ 4)
  ratedAt: string;            // ISO datetime string
};

// ── Item (clientNotes intentionally absent — PII stripped) ───────────────────

export type RatedItineraryItem = {
  itemId: string;
  sortOrder: number;
  type: ItineraryItemType;
  title: string;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  place: {
    name: string;
    formattedAddress: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  staffNotes: string | null;
  // clientNotes intentionally omitted (PII — never crosses this boundary)
};

// ── Day ──────────────────────────────────────────────────────────────────────

export type RatedItineraryDay = {
  dayId: string;
  dayNumber: number;
  date: string | null;        // ISO date string
  title: string;
  summary: string | null;
  items: RatedItineraryItem[];
};

// ── Itinerary ─────────────────────────────────────────────────────────────────

export type RatedItinerary = {
  itineraryId: string;
  title: string;
  summary: string | null;
  days: RatedItineraryDay[];
};

// ── Detail response (§5.2) ────────────────────────────────────────────────────

export type RatedItineraryDetail = {
  trip: RatedTripSummary;
  itinerary: RatedItinerary;
};

// ── List response (§5.1) ──────────────────────────────────────────────────────

export type RatedHistoryListResponse = {
  trips: RatedTripSummary[];
  hasMore: boolean;
  nextPage: number | null;
};

// ── Insert request/response types (derived from Zod schemas) ─────────────────

export type InsertSelection = z.infer<typeof insertSelectionSchema>;
export type InsertTarget = z.infer<typeof insertTargetSchema>;
export type InsertRequest = z.infer<typeof insertBodySchema>;

export type InsertResponse = {
  itinerary: RatedItinerary;
  missingStartDateAdvisory?: true;
};
