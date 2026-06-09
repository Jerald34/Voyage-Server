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

  it("requires auth for agency agent thread save (formerly approve-itinerary)", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/agencies/agency-1/agent/threads/thread-1/save")
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

  it("requires auth for current user profile updates", async () => {
    const app = createApp();

    const response = await request(app).patch("/auth/me").send({
      displayName: "Updated User"
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in is required."
      }
    });
  });

  it("rejects registration when the password matches the display name", async () => {
    const app = createApp();

    const response = await request(app).post("/auth/register").send({
      email: "new-user@example.com",
      password: "New User",
      displayName: "New User"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "custom",
            path: ["password"],
            message: "Password must be different from your name and email."
          })
        ])
      }
    });
  });

  it("rejects registration payloads with unknown keys", async () => {
    const app = createApp();

    const response = await request(app).post("/auth/register").send({
      email: "new-user@example.com",
      password: "correct horse battery staple",
      displayName: "New User",
      role: "SUPER_ADMIN"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            keys: ["role"]
          })
        ])
      }
    });
  });

  it("validates email verification request input", async () => {
    const app = createApp();

    const response = await request(app).post("/auth/email/verification/request").send({});

    expect(response.status).toBe(400);
  });

  it("rejects unknown login keys", async () => {
    const app = createApp();

    const response = await request(app).post("/auth/login").send({
      email: "user@example.com",
      password: "password",
      extra: true
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            keys: ["extra"]
          })
        ])
      }
    });
  });

  it("requires auth for agency settings updates", async () => {
    const app = createApp();

    const response = await request(app).patch("/agencies/agency-1/settings").send({
      name: "Updated Agency",
      businessPhone: "639003334444",
      businessEmail: "hello@example.com",
      city: "Olongapo City",
      country: "Philippines"
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in is required."
      }
    });
  });

  it("PATCH /threads/:id requires auth", async () => {
    const app = createApp();

    const res = await request(app)
      .patch(`/agencies/agency-1/agent/threads/thread-1`)
      .send({ title: "Honeymoon Bali" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in is required."
      }
    });
  });

  it("POST /threads/:id/save requires auth", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/agencies/agency-1/agent/threads/thread-1/save")
      .send({
        itineraryId: "00000000-0000-4000-8000-000000000010",
        clientName: "Test Client",
        destination: "Tokyo, Japan"
      });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in is required."
      }
    });
  });

  it("POST /threads/:id/approve (legacy alias) requires auth", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/agencies/agency-1/agent/threads/thread-1/approve")
      .send({
        itineraryId: "00000000-0000-4000-8000-000000000010",
        clientName: "Legacy Client",
        destination: "Lisbon"
      });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in is required."
      }
    });
  });
});
