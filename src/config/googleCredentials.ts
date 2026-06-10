import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
};

export type PreparedGoogleCredentials = {
  path: string;
  generated: boolean;
  cleanup(): void;
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

function createGeneratedCredentialLifecycle(parsedCredential: Record<string, unknown>): PreparedGoogleCredentials {
  const credentialDirectory = mkdtempSync(join(tmpdir(), "voyage-google-creds-"));
  const credentialPath = join(credentialDirectory, "application-credentials.json");

  writeFileSync(credentialPath, `${JSON.stringify(parsedCredential, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  const cleanup = () => {
    rmSync(credentialPath, { force: true });
    rmSync(credentialDirectory, { recursive: true, force: true });
  };

  return {
    path: credentialPath,
    generated: true,
    cleanup
  };
}

function createOperatorCredentialLifecycle(path: string): PreparedGoogleCredentials {
  return {
    path,
    generated: false,
    cleanup() {}
  };
}

export function prepareGoogleApplicationCredentials(
  options: PrepareGoogleCredentialsOptions = {}
): PreparedGoogleCredentials | null {
  const env = options.env ?? process.env;
  const existingCredentialPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (existingCredentialPath && existsSync(existingCredentialPath)) {
    return createOperatorCredentialLifecycle(existingCredentialPath);
  }

  const credentialJson = resolveCredentialJson(env);
  const credentialBase64 = resolveCredentialBase64(env);

  if (!credentialJson && !credentialBase64) {
    return null;
  }

  let parsedCredential: Record<string, unknown>;
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

  const lifecycle = createGeneratedCredentialLifecycle(parsedCredential);
  env.GOOGLE_APPLICATION_CREDENTIALS = lifecycle.path;
  return lifecycle;
}
