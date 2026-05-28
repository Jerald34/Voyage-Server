const MAX_LEN = 48;
const MAX_WORDS = 6;

export function deriveTitleFromMessage(content: string): string | null {
  const cleaned = String(content ?? "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const words = cleaned.split(" ").slice(0, MAX_WORDS);
  let title = words.join(" ");
  if (title.length > MAX_LEN) title = title.slice(0, MAX_LEN).trim();
  return title;
}

export function deriveTitleFromItineraryPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const candidates = [obj.destination, obj.title];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      return trimmed.length > MAX_LEN ? trimmed.slice(0, MAX_LEN).trim() : trimmed;
    }
  }
  return null;
}
