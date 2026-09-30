/**
 * Maps a Date to the northern-hemisphere season it falls in.
 *
 * Stage 1: always returns null (stub).
 * Stage 2A fills in the real implementation:
 *   Month 3–5  → 'spring'
 *   Month 6–8  → 'summer'
 *   Month 9–11 → 'fall'
 *   Month 12, 1, 2 → 'winter'
 */
export function startDateToSeason(
  date: Date | null
): "spring" | "summer" | "fall" | "winter" | null {
  if (date === null) {
    return null;
  }

  const month = date.getUTCMonth(); // 0-indexed: 0 = Jan, 11 = Dec

  if (month === 0 || month === 1 || month === 11) {
    return "winter";
  } else if (month === 2 || month === 3 || month === 4) {
    return "spring";
  } else if (month === 5 || month === 6 || month === 7) {
    return "summer";
  } else {
    // month === 8 || month === 9 || month === 10
    return "fall";
  }
}
