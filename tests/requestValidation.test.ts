import { describe, expect, it } from "vitest";

import {
  idParamsSchema,
  longTextSchema,
  normalizedNameSchema,
  opaqueTokenSchema,
  paginationQuerySchema,
  shortTextSchema,
  uuidParamSchema,
  uuidSchema
} from "../src/http/requestSchemas";

describe("requestSchemas", () => {
  it("accepts valid UUID params", () => {
    expect(uuidParamSchema.parse({ id: "550e8400-e29b-41d4-a716-446655440000" })).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000"
    });
  });

  it("rejects invalid UUID params", () => {
    const result = uuidParamSchema.safeParse({ id: "not-a-uuid" });

    expect(result.success).toBe(false);
  });

  it("rejects unknown UUID params", () => {
    const result = uuidParamSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      extra: "unexpected"
    });

    expect(result.success).toBe(false);
  });

  it("rejects opaque tokens shorter than 16 characters, longer than 512 characters, and trims whitespace", () => {
    expect(opaqueTokenSchema.safeParse("short").success).toBe(false);
    expect(opaqueTokenSchema.safeParse("x".repeat(513)).success).toBe(false);
    expect(opaqueTokenSchema.parse(`  ${"x".repeat(16)}  `)).toBe("x".repeat(16));
  });

  it("trims normalized names", () => {
    expect(normalizedNameSchema.parse("  Voyage Agency  ")).toBe("Voyage Agency");
    expect(shortTextSchema.parse("  Short text  ")).toBe("Short text");
    expect(longTextSchema.parse("  Long text  ")).toBe("Long text");
  });

  it("applies pagination defaults, coercion, bounds, and strict keys", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(paginationQuerySchema.parse({ cursor: "  abc  ", limit: "12" })).toEqual({
      cursor: "abc",
      limit: 12
    });

    expect(paginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: "3.2" }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ extra: "unexpected" }).success).toBe(false);
  });

  it("validates each UUID in a multi-name params schema", () => {
    const multiIdParamsSchema = idParamsSchema("tripId", "agencyId");

    expect(
      multiIdParamsSchema.parse({
        tripId: "550e8400-e29b-41d4-a716-446655440000",
        agencyId: "123e4567-e89b-12d3-a456-426614174000"
      })
    ).toEqual({
      tripId: "550e8400-e29b-41d4-a716-446655440000",
      agencyId: "123e4567-e89b-12d3-a456-426614174000"
    });

    expect(
      multiIdParamsSchema.safeParse({
        tripId: "550e8400-e29b-41d4-a716-446655440000",
        agencyId: "not-a-uuid"
      }).success
    ).toBe(false);
    expect(
      multiIdParamsSchema.safeParse({
        tripId: "550e8400-e29b-41d4-a716-446655440000",
        agencyId: "123e4567-e89b-12d3-a456-426614174000",
        extra: "unexpected"
      }).success
    ).toBe(false);
  });

  it("exposes the UUID primitive schema", () => {
    expect(uuidSchema.parse("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    );
  });
});
