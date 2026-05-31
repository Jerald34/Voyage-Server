/**
 * Typed errors for the ratedHistory module.
 *
 * Route handlers map these to HTTP status codes:
 *   SourceNotFoundError   → 404 (reason='missing') | 410 (reason='deleted')
 *   SameAgencyViolationError → 403
 *   MalformedSelectionError  → 400
 *   StaleVersionError        → 409
 *
 * MissingStartDateAdvisory is NOT thrown — it is a flag attached to a 200 response
 * body (`missingStartDateAdvisory: true`). Document here for clarity.
 */

export class SourceNotFoundError extends Error {
  /** 'missing' → 404; 'deleted' → 410 */
  readonly reason: "missing" | "deleted";
  readonly httpStatus: 404 | 410;

  constructor(reason: "missing" | "deleted") {
    super(
      reason === "deleted"
        ? "The source trip was deleted."
        : "Source trip, itinerary, day, or item not found."
    );
    this.name = "SourceNotFoundError";
    this.reason = reason;
    this.httpStatus = reason === "deleted" ? 410 : 404;
  }
}

export class SameAgencyViolationError extends Error {
  readonly httpStatus = 403 as const;

  constructor(message = "Source trip does not belong to the caller's agency.") {
    super(message);
    this.name = "SameAgencyViolationError";
  }
}

export class MalformedSelectionError extends Error {
  readonly httpStatus = 400 as const;
  readonly reason: string;

  constructor(reason: string) {
    super(`Malformed selection: ${reason}`);
    this.name = "MalformedSelectionError";
    this.reason = reason;
  }
}

export class StaleVersionError extends Error {
  readonly httpStatus = 409 as const;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Itinerary version mismatch: client sent ${expectedVersion}, server has ${actualVersion}. Refetch and retry.`
    );
    this.name = "StaleVersionError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * Not thrown — attached as `missingStartDateAdvisory: true` on a 200 response
 * when the target trip has no startDate. Insertion proceeds; dates on new days
 * are null.
 */
export const MISSING_START_DATE_ADVISORY = "missingStartDateAdvisory" as const;
