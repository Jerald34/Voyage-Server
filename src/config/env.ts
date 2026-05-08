import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/voyage"),
  APP_ORIGIN: z.string().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().default("voyage_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_PEPPER: z.string().default(""),
  ADMIN_EMAILS: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("Voyage <no-reply@example.com>"),
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:4000/auth/google/callback"),
  APPLE_CLIENT_ID: z.string().default(""),
  APPLE_TEAM_ID: z.string().default(""),
  APPLE_KEY_ID: z.string().default(""),
  APPLE_PRIVATE_KEY: z.string().default(""),
  APPLE_REDIRECT_URI: z.string().default("http://localhost:4000/auth/apple/callback"),
  LM_STUDIO_BASE_URL: z.string().default("http://localhost:1234/v1"),
  LM_STUDIO_MODEL: z.string().default("local-model"),
  LM_STUDIO_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_MODEL: z.string().default("openai/gpt-5.2"),
  OPENROUTER_REASONING_EFFORT: z.enum(["xhigh", "high", "medium", "low", "minimal", "none"]).default("medium"),
  GOOGLE_AI_API_KEY: z.string().default(""),
  GOOGLE_AI_MODEL: z.string().transform(v => v === "" ? undefined : v).default("gemini-1.5-flash"),
  GOOGLE_MAPS_API_KEY: z.string().default(""),
  GOOGLE_MAPS_MAX_CALLS_PER_RUN: z.coerce.number().int().nonnegative().default(20),
  NOMINATIM_BASE_URL: z.string().default("https://nominatim.openstreetmap.org"),
  NOMINATIM_USER_AGENT: z.string().default("Voyage-Travel-Agent/1.0"),
  SERPER_API_KEY: z.string().default(""),
  WEB_SEARCH_MAX_CALLS_PER_RUN: z.coerce.number().int().nonnegative().default(5)
});

export const env = envSchema.parse(process.env);

export function isProduction() {
  return env.NODE_ENV === "production";
}
