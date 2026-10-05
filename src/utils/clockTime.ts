/** "9" → "9:00", " 9:30 pm " → "9:30 PM". Anything else comes back trimmed and unchanged. */
export function normalizeClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) {
    return value.trim();
  }

  const hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const meridiem = match[3]?.toUpperCase();
  return meridiem ? `${hour}:${minute} ${meridiem}` : `${hour}:${minute}`;
}

/** Minutes after midnight for "14:00" or "2:00 PM"; null when the text is not a clock time. */
export function parseClockTimeToMinutes(value: string) {
  const normalized = normalizeClockTime(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  }
  return hour * 60 + minute;
}
