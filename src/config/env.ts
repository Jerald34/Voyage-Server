import "dotenv/config";
import { z } from "zod";

/** Default DATABASE_URL used in local development only — never valid in production. */
const DEV_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/voyage";

const trimmedString = () =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string()
  );

const trimmedStringWithDefault = (defaultValue: string) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, z.string().default(defaultValue));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default(DEV_DATABASE_URL),
  APP_ORIGIN: z.string().default("http://localhost:3000"),
  // Public origin of THIS API server, used to build absolute URLs (e.g. the photo proxy)
  // that get embedded in tool outputs and persisted in PlaceSnapshot metadata. Defaults to
  // the loopback PORT so local dev works; production must set this to the deployed URL.
  PUBLIC_API_ORIGIN: z.string().default(""),
  SESSION_COOKIE_NAME: z.string().default("voyage_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_PEPPER: z.string().default(""),
  ADMIN_EMAILS: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  RATE_LIMIT_REDIS_URL: trimmedString().default(""),
  RATE_LIMIT_PREFIX: trimmedStringWithDefault("voyage:rate-limit:"),
  RATE_LIMIT_BASELINE_MAX: z.coerce.number().int().positive().default(300),
  EMAIL_FROM: z.string().default("Voyage <no-reply@example.com>"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.preprocess(
    (value) => (typeof value === "string" ? value.toLowerCase() === "true" : value),
    z.boolean().default(false)
  ),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  // OAuth callbacks must return through the app-origin `/api` proxy so the session
  // cookie set on the callback is first-party to the app (required for iOS PWA).
  // In production set this to `${APP_ORIGIN}/api/auth/google/callback` and register
  // that exact URL in the Google Cloud console.
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:3000/api/auth/google/callback"),
  APPLE_CLIENT_ID: z.string().default(""),
  APPLE_TEAM_ID: z.string().default(""),
  APPLE_KEY_ID: z.string().default(""),
  APPLE_PRIVATE_KEY: z.string().default(""),
  // See GOOGLE_REDIRECT_URI — Apple callbacks must likewise return via the `/api`
  // proxy: `${APP_ORIGIN}/api/auth/apple/callback`, registered in the Apple console.
  APPLE_REDIRECT_URI: z.string().default("http://localhost:3000/api/auth/apple/callback"),
  LM_STUDIO_BASE_URL: z.string().default("http://localhost:1234/v1"),
  LM_STUDIO_MODEL: z.string().default("local-model"),
  LM_STUDIO_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_MODEL: z.string().default("openai/gpt-5.2"),
  OPENROUTER_REASONING_EFFORT: z.enum(["xhigh", "high", "medium", "low", "minimal", "none"]).default("medium"),
  MODEL_PROVIDER: z.preprocess(
    (value) => {
      const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
      return normalized === "" ? "auto" : normalized;
    },
    z.enum(["auto", "vertex", "openrouter", "google_ai", "gemini", "lm_studio"]).default("auto")
  ),
  GOOGLE_CLOUD_API_KEY: z.string().default(""),
  GOOGLE_CLOUD_PROJECT: z.string().default(""),
  GOOGLE_CLOUD_LOCATION: z.string().default("global"),
  GOOGLE_SA_CREDENTIALS: z.string().default(""),
  GOOGLE_AI_API_KEY: z.string().default(""),
  GOOGLE_AI_MODEL: z.string().transform(v => v === "" ? undefined : v).default("gemini-3-flash-preview"),
  GOOGLE_MAPS_API_KEY: z.string().default(""),
  GOOGLE_MAPS_MAX_CALLS_PER_RUN: z.coerce.number().int().nonnegative().default(30),
  NOMINATIM_BASE_URL: z.string().default("https://nominatim.openstreetmap.org"),
  NOMINATIM_USER_AGENT: z.string().default("Voyage-Travel-Agent/1.0"),
  SERPER_API_KEY: z.string().default(""),
  WEB_SEARCH_MAX_CALLS_PER_RUN: z.coerce.number().int().nonnegative().default(5),
  CLOUDINARY_CLOUD_NAME: z.string().default(""),
  CLOUDINARY_API_KEY: z.string().default(""),
  CLOUDINARY_API_SECRET: z.string().default(""),
  REVIEW_SCHEDULER_ENABLED: z.preprocess(
    (value) => (typeof value === "string" ? value.toLowerCase() !== "false" : value),
    z.boolean().default(true)
  ),
  // F5: Dedicated HMAC secret for trip-review tokens. Required in production.
  TRIP_REVIEW_SECRET: z.string().default("")
});

// ---------------------------------------------------------------------------
// F6 — Production secret validation
// ---------------------------------------------------------------------------
// If NODE_ENV=production, assert that all required secrets are present.
// This causes the process to fail at boot instead of silently using defaults
// that expose the deployment to security vulnerabilities.
//
// This check is skipped in development and test so local dev and CI continue
// to work without a full production secret configuration.
// ---------------------------------------------------------------------------

type Env = z.infer<typeof envSchema>;

function assertProductionSecrets(parsed: Env): void {
  if (parsed.NODE_ENV !== "production") return;

  const errors: string[] = [];

  if (!parsed.PASSWORD_PEPPER) {
    errors.push("PASSWORD_PEPPER must be set in production (bcrypt pepper cannot be empty).");
  }

  if (!parsed.TRIP_REVIEW_SECRET) {
    errors.push("TRIP_REVIEW_SECRET must be set in production (HMAC key for review tokens).");
  }

  if (parsed.DATABASE_URL === DEV_DATABASE_URL) {
    errors.push(
      "DATABASE_URL is set to the insecure development default. " +
        "Provide a real database URL for the production deployment."
    );
  }

  if (!parsed.RATE_LIMIT_REDIS_URL) {
    errors.push("RATE_LIMIT_REDIS_URL must be set in production.");
  }

  if (errors.length > 0) {
    throw new Error(
      `[env] Production deployment is missing required secrets:\n` +
        errors.map((e) => `  - ${e}`).join("\n") +
        "\n\nSet the above environment variables before starting in production."
    );
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.parse(source);
  assertProductionSecrets(parsed);
  return parsed;
}

export const env = parseEnv(process.env);

export function isProduction() {
  return env.NODE_ENV === "production";
}

// Resolved post-parse because the default depends on PORT (which is itself parsed from env).
export const publicApiOrigin = env.PUBLIC_API_ORIGIN.trim() !== ""
  ? env.PUBLIC_API_ORIGIN.replace(/\/+$/, "")
  : `http://localhost:${env.PORT}`;
