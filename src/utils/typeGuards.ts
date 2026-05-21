export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Alias kept for sites that historically used this name.
export const isRecordLike = isRecord;
