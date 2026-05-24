import { describe, expect, it } from "vitest";
import { buildShareResponse } from "../src/modules/shares/publicShareService";

describe("public share branding", () => {
  it("agency share returns agency branding", () => {
    const result = buildShareResponse({
      share: { id: "s", token: "t", agencyId: "a", clientName: null, clientEmail: null, createdAt: new Date(), expiresAt: null, revokedAt: null, viewCount: 0 } as any,
      agency: { id: "a", name: "Wanderlust Travel", logoImage: null } as any,
      itinerary: { id: "i", title: "Trip", summary: null, status: "APPROVED_INTERNAL", version: 1, days: [], createdAt: new Date(), updatedAt: new Date() } as any,
      creator: { id: "u-1", displayName: "Alice" } as any
    });
    expect(result.brand).toEqual({ type: "agency", name: "Wanderlust Travel", logoUrl: null });
  });

  it("personal share returns display-name branding (no avatar)", () => {
    const result = buildShareResponse({
      share: { id: "s", token: "t", agencyId: null, clientName: null, clientEmail: null, createdAt: new Date(), expiresAt: null, revokedAt: null, viewCount: 0 } as any,
      agency: null,
      itinerary: { id: "i", title: "Trip", summary: null, status: "DRAFT", version: 1, days: [], createdAt: new Date(), updatedAt: new Date() } as any,
      creator: { id: "u-1", displayName: "Alice" } as any
    });
    expect(result.brand).toEqual({ type: "personal", displayName: "Alice" });
  });
});
