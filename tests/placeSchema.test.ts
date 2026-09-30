import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");
const schema = readFileSync(resolve(repoRoot, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(repoRoot, "prisma/migrations/20260906000000_place_freshness_gate/migration.sql"),
  "utf8"
);

describe("place freshness gate schema", () => {
  it("declares the provider status and agency note enums", () => {
    expect(schema).toMatch(/enum PlaceBusinessStatus \{[^}]*OPERATIONAL[^}]*CLOSED_TEMPORARILY[^}]*CLOSED_PERMANENTLY[^}]*\}/s);
    expect(schema).toMatch(/enum AgencyPlaceNoteStatus \{[^}]*AVOID[^}]*CLOSED[^}]*PREFERRED[^}]*NEUTRAL[^}]*\}/s);
  });

  it("adds nullable status columns to PlaceSnapshot without touching fetchedAt", () => {
    const model = /model PlaceSnapshot \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";

    expect(model).toMatch(/businessStatus\s+PlaceBusinessStatus\?/);
    expect(model).toMatch(/businessStatusCheckedAt\s+DateTime\?/);
    expect(model).toMatch(/fetchedAt\s+DateTime\b(?!\?)/);
  });

  it("declares AgencyPlaceNote with a nullable provider identity pair", () => {
    const model = /model AgencyPlaceNote \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";

    expect(model).toMatch(/provider\s+PlaceProvider\?/);
    expect(model).toMatch(/providerPlaceId\s+String\?/);
    expect(model).toMatch(/placeName\s+String\b(?!\?)/);
    expect(model).toMatch(/cityContext\s+String\?/);
    expect(model).toMatch(/status\s+AgencyPlaceNoteStatus\s+@default\(NEUTRAL\)/);
    expect(model).toMatch(/@@unique\(\[agencyId, provider, providerPlaceId\]\)/);
    expect(model).toMatch(/@@index\(\[agencyId, cityContext\]\)/);
    expect(model).toMatch(/@@index\(\[agencyId, placeName\]\)/);
  });

  it("declares the opposite relations on Agency and User", () => {
    const agency = /model Agency \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    const user = /model User \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";

    expect(agency).toMatch(/placeNotes\s+AgencyPlaceNote\[\]/);
    expect(user).toMatch(/createdPlaceNotes\s+AgencyPlaceNote\[\]/);
  });
});

describe("place freshness gate migration", () => {
  it("is additive and leaves historical status null", () => {
    expect(migration).toMatch(/CREATE TYPE "PlaceBusinessStatus"/);
    expect(migration).toMatch(/CREATE TYPE "AgencyPlaceNoteStatus"/);
    expect(migration).toMatch(/ALTER TABLE "PlaceSnapshot"[\s\S]*?ADD COLUMN "businessStatus" "PlaceBusinessStatus"/);
    expect(migration).toMatch(/ADD COLUMN "businessStatusCheckedAt" TIMESTAMP\(3\)/);
    expect(migration).not.toMatch(/NOT NULL DEFAULT 'OPERATIONAL'/);
    expect(migration).not.toMatch(/UPDATE "PlaceSnapshot"/);
  });

  it("enforces the paired provider identity constraint and note indexes", () => {
    expect(migration).toMatch(
      /CONSTRAINT "AgencyPlaceNote_provider_id_pair"\s*\n?\s*CHECK \(\("provider" IS NULL\) = \("providerPlaceId" IS NULL\)\)/
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "AgencyPlaceNote_agencyId_provider_providerPlaceId_key"/
    );
    expect(migration).toMatch(/CREATE INDEX "AgencyPlaceNote_agencyId_cityContext_idx"/);
    expect(migration).toMatch(/CREATE INDEX "AgencyPlaceNote_agencyId_placeName_idx"/);
    expect(migration).toMatch(/REFERENCES "Agency"\("id"\) ON DELETE CASCADE/);
    expect(migration).toMatch(/REFERENCES "User"\("id"\) ON DELETE RESTRICT/);
  });
});

describe("place freshness gate contracts", () => {
  it("exposes the verdict, gate and observation contracts", async () => {
    const placeTypes = await import("../src/services/places/placeTypes");

    expect(typeof placeTypes).toBe("object");
    const source = readFileSync(resolve(repoRoot, "src/services/places/placeTypes.ts"), "utf8");
    expect(source).toMatch(/export type GateInput/);
    expect(source).toMatch(/export type BlockReason =\s*"CLOSED_PERMANENTLY" \| "AGENCY_AVOID" \| "AGENCY_CLOSED"/);
    expect(source).toMatch(/export type PlaceVerdict/);
    expect(source).toMatch(/export type NoteView/);
    expect(source).toMatch(/export type PlaceNote/);
    expect(source).toMatch(/export type PlaceAdvisory/);
    expect(source).toMatch(/export type PlaceGate/);
    expect(source).toMatch(/export type StatusObservation/);
  });
});
