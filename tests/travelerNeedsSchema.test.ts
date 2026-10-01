import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");
const migrationPath = resolve(repoRoot, "prisma/migrations/20261001000000_traveler_needs/migration.sql");

describe("traveler needs schema", () => {
  it("adds a nullable JSON column to AgentThread", () => {
    const schema = readFileSync(resolve(repoRoot, "prisma/schema.prisma"), "utf8");
    const model = /model AgentThread \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";

    expect(model).toMatch(/\btravelerNeeds\s+Json\?/);
  });

  it("ships an additive migration only", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/ALTER TABLE "AgentThread" ADD COLUMN "travelerNeeds" JSONB;/);
    expect(sql).not.toMatch(/DROP|NOT NULL|UPDATE/);
  });
});
