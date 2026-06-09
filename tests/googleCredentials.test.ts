import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { prepareGoogleApplicationCredentials } from "../src/config/googleCredentials";

type PreparedGoogleCredentials = {
  path: string;
  generated: boolean;
  cleanup(): void;
};

describe("prepareGoogleApplicationCredentials", () => {
  const generatedResources: PreparedGoogleCredentials[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const lifecycle of generatedResources.splice(0)) {
      lifecycle.cleanup();
    }

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createCredentialJson(projectId: string) {
    return JSON.stringify({
      type: "service_account",
      project_id: projectId,
      client_email: `${projectId}@example.com`
    });
  }

  it("creates a unique temporary credential directory for each generated credential file", () => {
    const first = prepareGoogleApplicationCredentials({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS_JSON: createCredentialJson("voyage-first")
      }
    });
    const second = prepareGoogleApplicationCredentials({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS_JSON: createCredentialJson("voyage-second")
      }
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.generated).toBe(true);
    expect(second?.generated).toBe(true);
    expect(first?.path).not.toBe(second?.path);
    expect(dirname(first!.path)).not.toBe(dirname(second!.path));
    expect(first?.path.startsWith(tmpdir())).toBe(true);
    expect(second?.path.startsWith(tmpdir())).toBe(true);
    expect(readFileSync(first!.path, "utf8")).toContain('"project_id": "voyage-first"');
    expect(readFileSync(second!.path, "utf8")).toContain('"project_id": "voyage-second"');

    generatedResources.push(first!, second!);
  });

  it("writes generated credentials with owner-only mode where supported", () => {
    const lifecycle = prepareGoogleApplicationCredentials({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS_JSON: createCredentialJson("voyage-permissions")
      }
    });

    expect(lifecycle).not.toBeNull();
    expect(lifecycle?.generated).toBe(true);
    expect(existsSync(lifecycle!.path)).toBe(true);

    if (process.platform !== "win32") {
      expect(statSync(lifecycle!.path).mode & 0o777).toBe(0o600);
    }

    generatedResources.push(lifecycle!);
  });

  it("returns a cleanup handle that removes generated credentials and their directory", () => {
    const lifecycle = prepareGoogleApplicationCredentials({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS_JSON: createCredentialJson("voyage-cleanup")
      }
    });

    expect(lifecycle).not.toBeNull();
    expect(lifecycle?.generated).toBe(true);
    expect(existsSync(lifecycle!.path)).toBe(true);
    expect(existsSync(dirname(lifecycle!.path))).toBe(true);

    lifecycle!.cleanup();
    lifecycle!.cleanup();

    expect(existsSync(lifecycle!.path)).toBe(false);
    expect(existsSync(dirname(lifecycle!.path))).toBe(false);
  });

  it("never deletes an operator-provided GOOGLE_APPLICATION_CREDENTIALS path", () => {
    const credentialDirectory = mkdtempSync(join(tmpdir(), "voyage-google-operator-"));
    const credentialPath = join(credentialDirectory, "operator-credentials.json");
    writeFileSync(
      credentialPath,
      JSON.stringify({
        type: "service_account",
        project_id: "voyage-operator",
        client_email: "operator@example.com"
      }) + "\n",
      "utf8"
    );

    temporaryDirectories.push(credentialDirectory);

    const lifecycle = prepareGoogleApplicationCredentials({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: credentialPath
      }
    });

    expect(lifecycle).not.toBeNull();
    expect(lifecycle?.path).toBe(credentialPath);
    expect(lifecycle?.generated).toBe(false);

    lifecycle!.cleanup();

    expect(existsSync(credentialPath)).toBe(true);
  });
});
