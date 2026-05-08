import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("app routes", () => {
  it("returns health status", async () => {
    const app = createApp();

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("requires auth for agency agent thread creation", async () => {
    const app = createApp();

    const response = await request(app).post("/agencies/agency-1/agent/threads").send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in is required."
      }
    });
  });

  it("requires auth for agency itinerary lookup", async () => {
    const app = createApp();

    const response = await request(app).get("/agencies/agency-1/itineraries/itinerary-1");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in is required."
      }
    });
  });

  it("requires auth for agency agent run streaming", async () => {
    const app = createApp();

    const response = await request(app).get("/agencies/agency-1/agent/runs/run-1/stream");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in is required."
      }
    });
  });

  it("requires auth for agency agent thread approval", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/agencies/agency-1/agent/threads/thread-1/approve-itinerary")
      .send({
        itineraryId: "00000000-0000-4000-8000-000000000010",
        clientName: "Santos Family",
        destination: "Olongapo City"
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in is required."
      }
    });
  });
});
