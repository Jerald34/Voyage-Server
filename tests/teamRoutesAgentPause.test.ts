// tests/teamRoutesAgentPause.test.ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const m = vi.hoisted(() => ({ listMembers: vi.fn(), requireVerifiedAgencyMember: vi.fn() }));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencies/teamRepository", () => ({ createPrismaTeamRepository: () => ({ listMembers: m.listMembers }) }));
vi.mock("../src/modules/agencies/invitationRepository", () => ({ createPrismaInvitationRepository: () => ({}) }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: m.requireVerifiedAgencyMember }
}));

import { errorHandler } from "../src/http/errors";
import { teamRoutes } from "../src/modules/agencies/teamRoutes";

const member = {
  id: "m2", agencyId: AGENCY, userId: "u2", role: "STAFF", status: "ACTIVE", createdAt: new Date("2026-09-01T00:00:00.000Z"),
  user: {
    id: "u2", email: "mara@hops.travel", displayName: "Mara",
    agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: new Date("2999-01-01T00:00:00.000Z"), agentPauseReason: "High usage"
  }
};

function app() {
  const a = express();
  a.use((req, _res, next) => {
    req.authUser = { id: "u1", role: "USER", status: "ACTIVE", memberships: [] } as any;
    next();
  });
  a.use("/agencies/:agencyId/team", teamRoutes);
  a.use(errorHandler);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.listMembers.mockResolvedValue([member]);
});

describe("GET /agencies/:agencyId/team agentPause", () => {
  it("shows owners and admins the pause and reason, without the raw columns", async () => {
    m.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY }, membership: { role: "OWNER" } });
    const res = await request(app()).get(`/agencies/${AGENCY}/team`);
    expect(res.status).toBe(200);
    expect(res.body.members[0].agentPause).toEqual({ until: "2999-01-01T00:00:00.000Z", reason: "High usage" });
    expect(res.body.members[0].user).toEqual({ id: "u2", email: "mara@hops.travel", displayName: "Mara" });
    expect(res.body.viewerRole).toBe("OWNER");
  });

  it("shows admins the pause too", async () => {
    m.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY }, membership: { role: "ADMIN" } });
    const res = await request(app()).get(`/agencies/${AGENCY}/team`);
    expect(res.body.members[0].agentPause).toEqual({ until: "2999-01-01T00:00:00.000Z", reason: "High usage" });
  });

  it("does not show staff another member's pause, and never leaks the raw columns to them", async () => {
    m.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY }, membership: { role: "STAFF" } });
    const res = await request(app()).get(`/agencies/${AGENCY}/team`);
    expect(res.body.members[0].agentPause).toBeNull();
    expect(res.body.members[0].user).toEqual({ id: "u2", email: "mara@hops.travel", displayName: "Mara" });
    expect(JSON.stringify(res.body)).not.toContain("High usage");
  });

  it("is null for a member who is not paused, or whose pause has ended", async () => {
    m.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY }, membership: { role: "OWNER" } });
    m.listMembers.mockResolvedValue([
      { ...member, id: "m3", user: { ...member.user, agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null } },
      {
        ...member,
        id: "m4",
        user: { ...member.user, agentPausedAt: new Date("2020-01-01T00:00:00.000Z"), agentPausedUntil: new Date("2020-01-02T00:00:00.000Z") }
      }
    ]);
    const res = await request(app()).get(`/agencies/${AGENCY}/team`);
    expect(res.body.members.map((x: { agentPause: unknown }) => x.agentPause)).toEqual([null, null]);
  });

  it("keeps an indefinite pause as until: null", async () => {
    m.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY }, membership: { role: "OWNER" } });
    m.listMembers.mockResolvedValue([{ ...member, user: { ...member.user, agentPausedUntil: null } }]);
    const res = await request(app()).get(`/agencies/${AGENCY}/team`);
    expect(res.body.members[0].agentPause).toEqual({ until: null, reason: "High usage" });
  });
});
