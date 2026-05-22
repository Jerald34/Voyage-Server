import { ApiError } from "../http/errors";

// Matches canonical UUIDs (v1-v5) emitted by Postgres' uuid type. We accept any version
// because the database does not constrain to v4 specifically.
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Throws an instructive ApiError if `value` is not a UUID. Surfaced back to the agent so it
// can self-correct on its next continuation turn instead of crashing inside Prisma.
export function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    const received = typeof value === "string" ? value : typeof value;
    throw new ApiError(
      400,
      "AGENT_TOOL_INPUT_INVALID",
      `${field} must be a UUID. Use the exact UUIDs returned by plan_itinerary or the most recent itinerary tool result. Received: ${received}.`
    );
  }
}
