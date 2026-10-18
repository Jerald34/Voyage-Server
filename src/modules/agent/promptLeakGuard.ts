/**
 * Deterministic backstop for the prompt's Confidentiality rules. The model
 * follows those rules most of the time, not always, so the orchestrator also
 * blocks obvious extraction requests before any model call and checks every
 * reply, streamed or final, for system prompt text.
 */

export const PROMPT_CANARY = "vyg-ops-7q4k2";

export const PROMPT_LEAK_REFUSAL =
  "I can't share my internal setup or instructions. I'm here to help with travel work: researching places, mapping routes, and drafting or editing itineraries.";

const SHINGLE_WORDS = 8;
// About 37 consecutive words copied from the prompt. The longest example reply
// the prompt itself suggests (the Japan answer) matches roughly 20.
const LEAKED_SHINGLE_THRESHOLD = 30;
// Headers no normal travel reply uses. Two of them means the prompt's outline.
const SECTION_MARKERS = [
  "intent gate before tool use",
  "place disambiguation policy",
  "itinerary planning intelligence",
  "hybrid map response policy",
  "core operating principle",
  "confidentiality and security",
  "id reuse rule"
];
const LEAKED_MARKER_THRESHOLD = 2;
// Text the stream guard keeps back until it is checked. Covers the shingle
// threshold, so a verbatim dump is caught before its first word is sent.
const STREAM_HOLDBACK_CHARS = 300;

const EXTRACTION_PATTERNS: RegExp[] = [
  /\bsystem\s+(prompt|instructions?)\b/i,
  /\b(initial|original|hidden|internal|developer|underlying)\s+(prompt|instructions?|configuration|config)\b/i,
  // Not "ignore the previous instructions": staff say that to change a trip request.
  /\b(ignore|disregard|forget|override)\s+(all\s+)?(of\s+)?(your|the\s+above|above|all\s+(the\s+)?(previous|prior))\s+(system\s+)?(instructions|prompts?|rules)\b/i,
  /\b(reveal|print|output|repeat|show|share|dump|display|translate|list|recite|tell\s+me)\b.{0,40}\byour\s+(\w+\s+){0,2}(instructions|prompt|rules|guidelines|configuration|config)\b/i,
  /\bsecret\s+(code|key|password|phrase|token)\b/i,
  /\b(diagnostic|debug|maintenance|developer|god|jailbreak|dan)\s+mode\b/i,
  /\b(everything|all\s+(the\s+)?text|the\s+text|words)\s+above\s+(this|here|the)\b/i
];

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function shingles(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i += 1) {
    out.push(words.slice(i, i + SHINGLE_WORDS).join(" "));
  }
  return out;
}

/** True when a user message is an obvious attempt to extract the prompt. */
export function looksLikePromptExtraction(userContent: string): boolean {
  return EXTRACTION_PATTERNS.some((pattern) => pattern.test(userContent));
}

export type PromptLeakDetector = (text: string) => boolean;

/** Detects replies that reproduce any of the given prompts. */
export function createPromptLeakDetector(prompts: string[]): PromptLeakDetector {
  const promptShingles = new Set(prompts.flatMap((prompt) => shingles(normalizeWords(prompt))));
  const canary = PROMPT_CANARY.replace(/[^a-z0-9]/g, "");

  return (text) => {
    const words = normalizeWords(text);
    if (words.join("").includes(canary)) return true;

    const joined = ` ${words.join(" ")} `;
    const markers = SECTION_MARKERS.filter((marker) => joined.includes(` ${marker} `)).length;
    if (markers >= LEAKED_MARKER_THRESHOLD) return true;

    const matched = new Set(shingles(words).filter((shingle) => promptShingles.has(shingle)));
    return matched.size >= LEAKED_SHINGLE_THRESHOLD;
  };
}

/**
 * Forwards streamed text, holding the newest characters back until they are
 * checked. Once a leak is found nothing more is forwarded.
 */
export function createStreamLeakGuard(
  isLeak: PromptLeakDetector,
  forward: (text: string) => Promise<void>,
  holdbackChars = STREAM_HOLDBACK_CHARS
) {
  let text = "";
  let sent = 0;
  let leaked = false;

  return {
    get leaked() {
      return leaked;
    },
    async push(delta: string) {
      if (leaked) return;
      text += delta;
      if (isLeak(text)) {
        leaked = true;
        return;
      }
      const safeEnd = text.length - holdbackChars;
      if (safeEnd > sent) {
        await forward(text.slice(sent, safeEnd));
        sent = safeEnd;
      }
    },
    /** Sends the held-back tail. Call once the stream has ended. */
    async flush() {
      if (leaked || sent >= text.length) return;
      await forward(text.slice(sent));
      sent = text.length;
    }
  };
}
