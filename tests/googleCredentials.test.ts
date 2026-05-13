import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareGoogleApplicationCredentials } from "../src/config/googleCredentials";

describe("prepareGoogleApplicationCredentials", () => {
  const originalEnv = {
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  };

  let tempDir: string;

  function restoreEnvValue(key: keyof typeof originalEnv) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "voyage-google-creds-"));
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  afterEach(() => {
    restoreEnvValue("GOOGLE_APPLICATION_CREDENTIALS");
    restoreEnvValue("GOOGLE_APPLICATION_CREDENTIALS_JSON");
    restoreEnvValue("GOOGLE_SERVICE_ACCOUNT_JSON");
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes GOOGLE_APPLICATION_CREDENTIALS_JSON to a temp file and points ADC at it", () => {
    const credentialJson = JSON.stringify({
      type: "service_account",
      project_id: "voyage-test",
      client_email: "voyage@example.com"
    });

    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = credentialJson;
    const credentialPath = join(tempDir, "gcp-sa.json");

    const result = prepareGoogleApplicationCredentials({
      env: process.env,
      credentialPath
    });

    expect(result).toBe(credentialPath);
    expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBe(credentialPath);
    expect(existsSync(credentialPath)).toBe(true);
    expect(readFileSync(credentialPath, "utf8")).toContain('"project_id": "voyage-test"');
  });

  it("accepts GOOGLE_SERVICE_ACCOUNT_JSON as a compatibility alias", () => {
    const credentialJson = JSON.stringify({
      type: "service_account",
      project_id: "voyage-test-alias",
      client_email: "voyage-alias@example.com"
    });

    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = credentialJson;
    const credentialPath = join(tempDir, "alias-gcp-sa.json");

    const result = prepareGoogleApplicationCredentials({
      env: process.env,
      credentialPath
    });

    expect(result).toBe(credentialPath);
    expect(readFileSync(credentialPath, "utf8")).toContain('"project_id": "voyage-test-alias"');
  });

  it("keeps an existing credential file path when it already exists", () => {
    const existingCredentialPath = join(tempDir, "existing.json");
    process.env.GOOGLE_APPLICATION_CREDENTIALS = existingCredentialPath;
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({
      type: "service_account",
      project_id: "ignored",
      client_email: "ignored@example.com"
    });

    writeFileSync(existingCredentialPath, "{\"type\":\"service_account\"}\n", "utf8");
    expect(existsSync(existingCredentialPath)).toBe(true);

    const result = prepareGoogleApplicationCredentials({
      env: process.env,
      credentialPath: join(tempDir, "should-not-be-used.json")
    });

    expect(result).toBe(existingCredentialPath);
    expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBe(existingCredentialPath);
  });
});
