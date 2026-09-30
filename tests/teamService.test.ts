import { describe, expect, it } from "vitest";
import { createTeamService } from "../src/modules/agencies/teamService";
import type { TeamRepository, TeamMembershipRecord } from "../src/modules/agencies/teamRepository";

function fakeRepo(seed: Partial<{
  byEmail: Record<string, { id: string }>;
  members: TeamMembershipRecord[];
}> = {}): TeamRepository & { created: any[] } {
  const created: any[] = [];
  return {
    created,
    async findUserByEmail(email) { return seed.byEmail?.[email] ?? null; },
    async listMembers() { return seed.members ?? []; },
    async createMembership(input) {
      created.push(input);
      return { id: "m-new", agencyId: input.agencyId, userId: input.userId, role: input.role, status: "ACTIVE", user: { id: input.userId, email: "x@example.com", displayName: "X" }, createdAt: new Date() };
    },
    async updateMembershipRole() { throw new Error("not used"); },
    async deleteMembership() { throw new Error("not used"); },
    async findMembershipById() { return null; },
    async transferOwnership() { throw new Error("not used"); }
  };
}

describe("teamService.addExistingUserToAgency", () => {
  it("creates a STAFF membership", async () => {
    const repo = fakeRepo();
    const service = createTeamService({ repository: repo });
    await service.addExistingUserToAgency({ agencyId: "agency-1", userId: "user-2", role: "STAFF" });
    expect(repo.created).toEqual([{ agencyId: "agency-1", userId: "user-2", role: "STAFF" }]);
  });

  it("rejects an invalid role", async () => {
    const repo = fakeRepo();
    const service = createTeamService({ repository: repo });
    await expect(
      service.addExistingUserToAgency({ agencyId: "agency-1", userId: "u", role: "OWNER" as any })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_INVITE_ROLE" });
  });
});

describe("teamService.removeMember", () => {
  it("removes a STAFF member", async () => {
    let deleted: string | null = null;
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById(id) {
        return id === "m-staff"
          ? { id: "m-staff", agencyId: "agency-1", userId: "user-3", role: "STAFF", status: "ACTIVE", user: { id: "user-3", email: "s@x", displayName: "S" }, createdAt: new Date() }
          : null;
      },
      async deleteMembership(id) { deleted = id; }
    };
    const service = createTeamService({ repository: repo });
    await service.removeMember({ agencyId: "agency-1", membershipId: "m-staff" });
    expect(deleted).toBe("m-staff");
  });

  it("rejects removing the OWNER with OWNER_PROTECTED", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-owner", agencyId: "agency-1", userId: "owner-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", email: "o@x", displayName: "O" }, createdAt: new Date() };
      },
      async deleteMembership() { throw new Error("should not delete"); }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.removeMember({ agencyId: "agency-1", membershipId: "m-owner" })
    ).rejects.toMatchObject({ statusCode: 403, code: "OWNER_PROTECTED" });
  });

  it("rejects when membership does not belong to the agency", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-other", agencyId: "OTHER-AGENCY", userId: "user-4", role: "STAFF", status: "ACTIVE", user: { id: "user-4", email: "x@x", displayName: "X" }, createdAt: new Date() };
      },
      async deleteMembership() { throw new Error("should not delete"); }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.removeMember({ agencyId: "agency-1", membershipId: "m-other" })
    ).rejects.toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });
  });
});

describe("teamService.changeMemberRole", () => {
  it("promotes a STAFF to ADMIN", async () => {
    let updated: { id: string; role: string } | null = null;
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-staff", agencyId: "agency-1", userId: "user-3", role: "STAFF", status: "ACTIVE", user: { id: "user-3", email: "s@x", displayName: "S" }, createdAt: new Date() };
      },
      async updateMembershipRole(id, role) {
        updated = { id, role };
        return { id, agencyId: "agency-1", userId: "user-3", role, status: "ACTIVE", user: { id: "user-3", email: "s@x", displayName: "S" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await service.changeMemberRole({ agencyId: "agency-1", membershipId: "m-staff", role: "ADMIN" });
    expect(updated).toEqual({ id: "m-staff", role: "ADMIN" });
  });

  it("rejects changing the OWNER role", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-owner", agencyId: "agency-1", userId: "owner-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", email: "o@x", displayName: "O" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.changeMemberRole({ agencyId: "agency-1", membershipId: "m-owner", role: "ADMIN" })
    ).rejects.toMatchObject({ statusCode: 403, code: "OWNER_PROTECTED" });
  });

  it("rejects promoting to OWNER (must use Transfer Ownership)", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-admin", agencyId: "agency-1", userId: "user-2", role: "ADMIN", status: "ACTIVE", user: { id: "user-2", email: "a@x", displayName: "A" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.changeMemberRole({ agencyId: "agency-1", membershipId: "m-admin", role: "OWNER" as any })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_TARGET_ROLE" });
  });
});

describe("teamService.transferOwnership", () => {
  it("atomically swaps OWNER and updates Agency.ownerUserId", async () => {
    const transfers: any[] = [];
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById(id) {
        if (id === "m-current-owner") return { id, agencyId: "agency-1", userId: "owner-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", email: "o@x", displayName: "O" }, createdAt: new Date() };
        if (id === "m-target-admin") return { id, agencyId: "agency-1", userId: "admin-2", role: "ADMIN", status: "ACTIVE", user: { id: "admin-2", email: "a@x", displayName: "A" }, createdAt: new Date() };
        return null;
      },
      async transferOwnership(input) { transfers.push(input); }
    };
    const service = createTeamService({ repository: repo });
    await service.transferOwnership({
      agencyId: "agency-1",
      currentOwnerMembershipId: "m-current-owner",
      targetMembershipId: "m-target-admin"
    });
    expect(transfers).toEqual([{ agencyId: "agency-1", fromUserId: "owner-1", toUserId: "admin-2" }]);
  });

  it("rejects when current OWNER membership is not actually OWNER", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-x", agencyId: "agency-1", userId: "u-1", role: "ADMIN", status: "ACTIVE", user: { id: "u-1", email: "x@x", displayName: "X" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.transferOwnership({ agencyId: "agency-1", currentOwnerMembershipId: "m-x", targetMembershipId: "m-x" })
    ).rejects.toMatchObject({ statusCode: 400, code: "NOT_CURRENT_OWNER" });
  });

  it("rejects when target is the same as current OWNER", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-owner", agencyId: "agency-1", userId: "owner-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", email: "o@x", displayName: "O" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.transferOwnership({ agencyId: "agency-1", currentOwnerMembershipId: "m-owner", targetMembershipId: "m-owner" })
    ).rejects.toMatchObject({ statusCode: 400, code: "TRANSFER_SAME_USER" });
  });
});
