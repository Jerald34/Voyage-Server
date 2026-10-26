// tests/apiErrorDetails.test.ts
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ApiError, errorHandler } from "../src/http/errors";

function appThrowing(error: unknown) {
  const app = express();
  app.get("/boom", () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe("ApiError details", () => {
  it("merges details into the error body next to code and message", async () => {
    const res = await request(
      appThrowing(new ApiError(409, "OWNER_HAS_NO_SUCCESSOR", "Bayani Tours has no other members.", { agencyId: "a1", agencyName: "Bayani Tours" }))
    ).get("/boom");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: "OWNER_HAS_NO_SUCCESSOR", message: "Bayani Tours has no other members.", agencyId: "a1", agencyName: "Bayani Tours" }
    });
  });

  it("never lets details overwrite code or message", async () => {
    const res = await request(appThrowing(new ApiError(400, "REAL", "Real message.", { code: "FAKE", message: "Fake." }))).get("/boom");
    expect(res.body.error).toEqual({ code: "REAL", message: "Real message." });
  });

  it("keeps the old shape when there are no details", async () => {
    const res = await request(appThrowing(new ApiError(404, "NOT_FOUND", "Nope."))).get("/boom");
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Nope." } });
  });
});
