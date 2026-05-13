import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const CREDENTIAL_ENV_NAMES = [
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  "GOOGLE_SERVICE_ACCOUNT_JSON"
] as const;

const CREDENTIAL_B64_ENV_NAMES = [
  "GOOGLE_APPLICATION_CREDENTIALS_B64",
  "GOOGLE_SERVICE_ACCOUNT_B64"
] as const;

type PrepareGoogleCredentialsOptions = {
  env?: NodeJS.ProcessEnv;
  credentialPath?: string;
};

function resolveCredentialJson(env: NodeJS.ProcessEnv) {
  for (const name of CREDENTIAL_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) {
      return { name, value };
    }
  }

  return null;
}

function resolveCredentialBase64(env: NodeJS.ProcessEnv) {
  for (const name of CREDENTIAL_B64_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) {
      return { name, value };
    }
  }

  return null;
}

function parseCredentialJson(value: string) {
  const trimmed = value.trim();

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") {
      return JSON.parse(parsed) as Record<string, unknown>;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return JSON.parse(trimmed.replace(/^["']|["']$/g, "")) as Record<string, unknown>;
  }
}

function parseCredentialBase64(value: string) {
  const normalized = value.trim().replace(/\s+/g, "");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = Buffer.from(padded, "base64").toString("utf8").trim();
  if (!decoded) {
    throw new Error("Decoded Google credentials base64 was empty.");
  }

  return parseCredentialJson(decoded);
}

export function prepareGoogleApplicationCredentials(options: PrepareGoogleCredentialsOptions = {}) {
  const env = options.env ?? process.env;
  const credentialPath = options.credentialPath ?? join(tmpdir(), "voyage-google-application-credentials.json");

  const existingCredentialPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (existingCredentialPath && existsSync(existingCredentialPath)) {
    return existingCredentialPath;
  }

  const credentialJson = resolveCredentialJson(env);
  const credentialBase64 = resolveCredentialBase64(env);

  if (!credentialJson && !credentialBase64) {
    return null;
  }

  let parsedCredential: unknown;
  if (credentialJson) {
    try {
      parsedCredential = parseCredentialJson(credentialJson.value);
    } catch {
      throw new Error(
        `Invalid Google service account JSON in ${credentialJson.name}. Paste the raw JSON contents, not a path.`
      );
    }
  } else if (credentialBase64) {
    try {
      parsedCredential = parseCredentialBase64(credentialBase64.value);
    } catch {
      throw new Error(
        `Invalid Google service account base64 in ${credentialBase64.name}. Paste the base64-encoded JSON, not a path.`
      );
    }
  } else {
    return null;
  }

  mkdirSync(dirname(credentialPath), { recursive: true });
  writeFileSync(credentialPath, `${JSON.stringify(parsedCredential, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  return credentialPath;
}
