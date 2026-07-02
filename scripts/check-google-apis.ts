/**
 * Live health-check for every Google API the server depends on.
 *
 * Unlike the unit tests (which mock the network), this script makes REAL calls
 * with the credentials in your environment and reports whether each Google
 * service is actually reachable and the keys are accepted.
 *
 *   npm run check:google           # check everything configured in .env
 *
 * Exit code is non-zero if any *configured* service fails, so it doubles as a
 * CI/deploy smoke test. Services with no credentials are reported as SKIP and
 * do not fail the run.
 *
 * Services covered:
 *   1. Google Vertex AI (Gemini)      — aiplatform.googleapis.com
 *   2. Google AI / Generative Language — generativelanguage.googleapis.com
 *   3. Google Maps / Places (New)      — places.googleapis.com
 *   4. Google OAuth (sign-in)          — oauth2.googleapis.com
 *   5. Serper web search (Google SERP) — google.serper.dev
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "../src/config/env";
import { createGoogleVertexModelProvider } from "../src/services/modelProvider/vertex";
import { createGoogleMapsProvider } from "../src/services/maps/googleMaps";
import { createWebSearchProvider } from "../src/services/webSearch";

type Status = "ok" | "warn" | "fail" | "skip";

type CheckResult = {
  name: string;
  status: Status;
  detail: string;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const MODEL_TIMEOUT_MS = 45_000;

function ok(detail: string): { status: Status; detail: string } {
  return { status: "ok", detail };
}
function warn(detail: string): { status: Status; detail: string } {
  return { status: "warn", detail };
}
function fail(detail: string): { status: Status; detail: string } {
  return { status: "fail", detail };
}
function skip(detail: string): { status: Status; detail: string } {
  return { status: "skip", detail };
}

/** Reject with a clear message if the check runs longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Mirrors the ADC detection in modelProvider/selection.ts. */
function hasLocalAdcCredentials(): boolean {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    join(process.env.APPDATA ?? "", "gcloud", "application_default_credentials.json"),
    join(process.env.USERPROFILE ?? "", ".config", "gcloud", "application_default_credentials.json")
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return candidates.some((filePath) => existsSync(filePath));
}

// ---------------------------------------------------------------------------
// Individual checks. Each returns a status + human-readable detail.
// ---------------------------------------------------------------------------

async function checkVertexAi() {
  const hasApiKey = env.GOOGLE_CLOUD_API_KEY.trim().length > 0;
  const hasServiceAccount = env.GOOGLE_SA_CREDENTIALS.trim().length > 0;
  const hasAdc = hasLocalAdcCredentials();
  if (!hasApiKey && !hasServiceAccount && !hasAdc) {
    return skip("no GOOGLE_CLOUD_API_KEY / GOOGLE_SA_CREDENTIALS / ADC configured");
  }

  const authMode = hasServiceAccount
    ? "service account"
    : hasAdc
      ? "ADC"
      : "API key (express mode)";
  const provider = createGoogleVertexModelProvider();
  const result = await provider.complete({
    messages: [{ role: "user", content: "Reply with the single word: pong" }],
    temperature: 0
  });
  const reply = result.content.trim().replace(/\s+/g, " ").slice(0, 40);
  const tokens = result.usage?.totalTokenCount;
  return ok(
    `model=${env.GOOGLE_AI_MODEL} via ${authMode} → "${reply}"` +
      (typeof tokens === "number" ? ` (${tokens} tokens)` : "")
  );
}

async function checkGoogleAi() {
  const key = env.GOOGLE_AI_API_KEY.trim();
  if (!key) return skip("GOOGLE_AI_API_KEY not set");

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return fail(`models list returned ${response.status} ${response.statusText} ${body.slice(0, 160)}`);
  }
  const data = (await response.json()) as { models?: unknown[] };
  const count = Array.isArray(data.models) ? data.models.length : 0;
  return ok(`Generative Language API reachable, key accepted (${count} models listed)`);
}

async function checkMaps() {
  if (!env.GOOGLE_MAPS_API_KEY.trim()) return skip("GOOGLE_MAPS_API_KEY not set");

  const provider = createGoogleMapsProvider();
  // resolvePlace uses the cheap Essentials field mask (~$5/1k) rather than the
  // full Enterprise+Atmosphere mask, so this smoke test stays inexpensive.
  const resolved = await provider.resolvePlace({
    placeName: "Eiffel Tower",
    cityContext: "Paris",
    countryCode: "FR"
  });
  return ok(
    `Places searchText OK → ${resolved.name} (${resolved.location.latitude.toFixed(3)}, ${resolved.location.longitude.toFixed(3)})`
  );
}

async function checkOAuth() {
  const clientId = env.GOOGLE_CLIENT_ID.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET.trim();
  if (!clientId && !clientSecret) return skip("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
  if (!clientId || !clientSecret) {
    return fail(
      `incomplete config — ${!clientId ? "GOOGLE_CLIENT_ID" : "GOOGLE_CLIENT_SECRET"} is missing`
    );
  }

  // Validate the client credentials without a real user sign-in: exchange a
  // deliberately-invalid authorization code. Google authenticates the *client*
  // before validating the code, so the error it returns tells us whether the
  // id/secret are accepted:
  //   invalid_client        → bad GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
  //   invalid_grant         → client accepted (the dummy code is rejected, as expected)
  //   redirect_uri_mismatch → client accepted, but GOOGLE_REDIRECT_URI isn't registered
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: "voyage-health-check-invalid-code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: env.GOOGLE_REDIRECT_URI
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; error_description?: string };

  switch (data.error) {
    case "invalid_grant":
      return ok("client credentials accepted by Google (dummy code correctly rejected)");
    case "redirect_uri_mismatch":
      return warn(
        `client id/secret valid, but GOOGLE_REDIRECT_URI (${env.GOOGLE_REDIRECT_URI}) is not registered in the console`
      );
    case "invalid_client":
      return fail("invalid_client — Google rejected GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
    default:
      if (response.ok) return ok("token endpoint reachable");
      return warn(
        `unexpected token response ${response.status}: ${data.error ?? "unknown"} — ${data.error_description ?? ""}`.trim()
      );
  }
}

async function checkWebSearch() {
  if (!env.SERPER_API_KEY.trim()) return skip("SERPER_API_KEY not set");

  const provider = createWebSearchProvider();
  const results = await provider.search({ query: "Voyage travel planning", num: 1 });
  return ok(`Serper (Google SERP) returned ${results.length} result(s)`);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const CHECKS: Array<{ name: string; run: () => Promise<{ status: Status; detail: string }>; timeoutMs: number }> = [
  { name: "Vertex AI (Gemini)", run: checkVertexAi, timeoutMs: MODEL_TIMEOUT_MS },
  { name: "Google AI (Generative Language)", run: checkGoogleAi, timeoutMs: DEFAULT_TIMEOUT_MS },
  { name: "Google Maps / Places", run: checkMaps, timeoutMs: DEFAULT_TIMEOUT_MS },
  { name: "Google OAuth (sign-in)", run: checkOAuth, timeoutMs: DEFAULT_TIMEOUT_MS },
  { name: "Serper web search (Google SERP)", run: checkWebSearch, timeoutMs: DEFAULT_TIMEOUT_MS }
];

const LABEL: Record<Status, string> = {
  ok: "[ OK ]",
  warn: "[WARN]",
  fail: "[FAIL]",
  skip: "[SKIP]"
};

async function main() {
  console.log("Checking Google API services...\n");

  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    let outcome: { status: Status; detail: string };
    try {
      outcome = await withTimeout(check.run(), check.timeoutMs);
    } catch (error) {
      outcome = fail(errorMessage(error));
    }
    results.push({ name: check.name, ...outcome });
    console.log(`${LABEL[outcome.status]} ${check.name.padEnd(34)} ${outcome.detail}`);
  }

  const counts = results.reduce<Record<Status, number>>(
    (acc, r) => {
      acc[r.status] += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0, skip: 0 }
  );

  console.log(
    `\nSummary: ${counts.ok} ok, ${counts.warn} warn, ${counts.fail} failed, ${counts.skip} skipped (not configured).`
  );

  if (counts.fail > 0) {
    console.error("\nOne or more configured Google services are NOT working (see [FAIL] above).");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("check-google-apis crashed:", errorMessage(error));
  process.exit(1);
});
