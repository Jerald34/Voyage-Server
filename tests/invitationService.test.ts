import { describe, expect, it, vi } from "vitest";
import { createInvitationService } from "../src/modules/agencies/invitationService";
import type {
  InvitationRecord,
  InvitationRepository,
  InvitationWithContext
} from "../src/modules/agencies/invitationRepository";
import type { TeamRepository, TeamMembershipRecord } from "../src/modules/agencies/teamRepository";
import { hashToken } from "../src/services/tokens";

function makeInvitationRepo(): InvitationRepository & { records: InvitationRecord[] } {
  const records: InvitationRecord[] = [];
  return {
    records,
    async create(input) {
      const record: InvitationRecord = {
        id: `inv-${records.length + 1}`,
        acceptedAt: null,
        acceptedByUserId: null,
        revokedAt: null,
        revokedByUserId: null,
        createdAt: new Date("2026-05-25T00:00:00.000Z"),
        ...input
      };
      records.push(record);
      return record;
    },
    async findByTokenHash(tokenHash) {
      const record = records.find((r) => r.tokenHash === tokenHash);
      if (!record) return null;
      return {
        ...record,
        agency: { id: record.agencyId, name: "Voyage Test", status: "VERIFIED" },
        invitedByUser: { id: record.invitedByUserId, displayName: "Inviter", email: "inviter@x.com" }
      } as InvitationWithContext;
    },
    async findById(id) {
      return records.find((r) => r.id === id) ?? null;
    },
    async findActiveByAgencyAndEmail(agencyId, emailNormalized, now) {
      return records.find(
        (r) =>
          r.agencyId === agencyId &&
          r.emailNormalized === emailNormalized &&
          !r.acceptedAt &&
          !r.revokedAt &&
          r.expiresAt > now
      ) ?? null;
    },
    async listOutstanding(agencyId, now) {
      return records.filter(
        (r) => r.agencyId === agencyId && !r.acceptedAt && !r.revokedAt && r.expiresAt > now
      );
    },
    async markAccepted(id, acceptedAt, acceptedByUserId) {
      const record = records.find((r) => r.id === id)!;
      record.acceptedAt = acceptedAt;
      record.acceptedByUserId = acceptedByUserId;
      return record;
    },
    async markRevoked(id, revokedAt, revokedByUserId) {
      const record = records.find((r) => r.id === id)!;
      record.revokedAt = revokedAt;
      record.revokedByUserId = revokedByUserId;
      return record;
    }
  };
}

function makeTeamRepo(initialMembers: TeamMembershipRecord[] = []): TeamRepository {
  const members = [...initialMembers];
  return {
    async listMembers() {
      return members;
    },
    async findUserByEmail() { return null; },
    async createMembership() { throw new Error("not used"); },
    async updateMembershipRole() { throw new Error("not used"); },
    async deleteMembership() { throw new Error("not used"); },
    async findMembershipById() { return null; },
    async transferOwnership() { throw new Error("not used"); }
  };
}

function makeService(opts?: { existingUser?: { id: string; emailNormalized: string } | null; members?: TeamMembershipRecord[] }) {
  const invitationRepository = makeInvitationRepo();
  const teamRepository = makeTeamRepo(opts?.members);
  const emailSender = { sendAgencyInvitationEmail: vi.fn().mockResolvedValue(undefined) };
  const addExistingUserToAgency = vi.fn().mockResolvedValue(undefined);
  const promoteUserToAgencyAccount = vi.fn().mockResolvedValue(undefined);
  const service = createInvitationService({
    invitationRepository,
    teamRepository,
    findUserByEmail: async () => opts?.existingUser ?? null,
    addExistingUserToAgency,
    promoteUserToAgencyAccount,
    emailSender,
    now: () => new Date("2026-05-25T12:00:00.000Z"),
    appOrigin: "http://localhost:3000"
  });
  return { service, invitationRepository, emailSender, addExistingUserToAgency, promoteUserToAgencyAccount };
}

describe("invitationService.invite", () => {
  it("creates an invitation and emails a hashed-token link", async () => {
    const { service, invitationRepository, emailSender } = makeService();
    const result = await service.invite({
      agencyId: "agency-1",
      agencyName: "Voyage Test",
      inviter: { id: "owner-1", displayName: "Boss" },
      email: "New@Example.com",
      role: "STAFF"
    });

    expect(invitationRepository.records).toHaveLength(1);
    const stored = invitationRepository.records[0];
    expect(stored.emailNormalized).toBe("new@example.com");
    expect(stored.role).toBe("STAFF");
    expect(stored.tokenHash).not.toEqual(expect.stringContaining(" "));

    const emailCall = emailSender.sendAgencyInvitationEmail.mock.calls.at(-1)?.[0];
    const acceptUrl = new URL(emailCall.acceptUrl);
    const rawToken = acceptUrl.searchParams.get("token") ?? "";
    expect(hashToken(rawToken)).toBe(stored.tokenHash);
    expect(result.id).toBe(stored.id);
  });

  it("rejects when an outstanding invitation already exists", async () => {
    const { service } = makeService();
    await service.invite({
      agencyId: "agency-1",
      agencyName: "Voyage Test",
      inviter: { id: "owner-1", displayName: "Boss" },
      email: "dup@example.com",
      role: "STAFF"
    });
    await expect(
      service.invite({
        agencyId: "agency-1",
        agencyName: "Voyage Test",
        inviter: { id: "owner-1", displayName: "Boss" },
        email: "DUP@example.com",
        role: "ADMIN"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "INVITATION_ALREADY_PENDING" });
  });

  it("rejects when the invitee is already a member", async () => {
    const existingMember: TeamMembershipRecord = {
      id: "m-1",
      agencyId: "agency-1",
      userId: "user-2",
      role: "STAFF",
      status: "ACTIVE",
      user: { id: "user-2", email: "already@example.com", displayName: "Already" },
      createdAt: new Date()
    };
    const { service } = makeService({
      existingUser: { id: "user-2", emailNormalized: "already@example.com" },
      members: [existingMember]
    });
    await expect(
      service.invite({
        agencyId: "agency-1",
        agencyName: "Voyage Test",
        inviter: { id: "owner-1", displayName: "Boss" },
        email: "already@example.com",
        role: "STAFF"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_A_MEMBER" });
  });
});

describe("invitationService.lookup + accept", () => {
  it("looks up an invitation and reports whether the account exists", async () => {
    const { service, emailSender } = makeService({ existingUser: { id: "user-7", emailNormalized: "new@example.com" } });
    await service.invite({
      agencyId: "agency-1",
      agencyName: "Voyage Test",
      inviter: { id: "owner-1", displayName: "Boss" },
      email: "new@example.com",
      role: "STAFF"
    });
    const rawToken = new URL(
      emailSender.sendAgencyInvitationEmail.mock.calls.at(-1)?.[0].acceptUrl
    ).searchParams.get("token") ?? "";
    const result = await service.lookup(rawToken);
    expect(result).toMatchObject({
      emailNormalized: "new@example.com",
      role: "STAFF",
      accountExists: true
    });
  });

  it("rejects accept when the user's email doesn't match the invite", async () => {
    const { service, emailSender } = makeService();
    await service.invite({
      agencyId: "agency-1",
      agencyName: "Voyage Test",
      inviter: { id: "owner-1", displayName: "Boss" },
      email: "invitee@example.com",
      role: "STAFF"
    });
    const rawToken = new URL(
      emailSender.sendAgencyInvitationEmail.mock.calls.at(-1)?.[0].acceptUrl
    ).searchParams.get("token") ?? "";
    await expect(
      service.accept({ rawToken, user: { id: "intruder", emailNormalized: "other@example.com", accountType: "AGENCY_USER" } })
    ).rejects.toMatchObject({ statusCode: 403, code: "INVITATION_EMAIL_MISMATCH" });
  });

  it("accepts a matching invite and creates the membership", async () => {
    const { service, addExistingUserToAgency, invitationRepository, emailSender } = makeService();
    await service.invite({
      agencyId: "agency-9",
      agencyName: "Voyage Test",
      inviter: { id: "owner-1", displayName: "Boss" },
      email: "joiner@example.com",
      role: "ADMIN"
    });
    const rawToken = new URL(
      emailSender.sendAgencyInvitationEmail.mock.calls.at(-1)?.[0].acceptUrl
    ).searchParams.get("token") ?? "";
    const result = await service.accept({
      rawToken,
      user: { id: "user-99", emailNormalized: "joiner@example.com", accountType: "AGENCY_USER" }
    });
    expect(result).toEqual({ agencyId: "agency-9", alreadyMember: false });
    expect(addExistingUserToAgency).toHaveBeenCalledWith({
      agencyId: "agency-9",
      userId: "user-99",
      role: "ADMIN"
    });
    expect(invitationRepository.records[0].acceptedByUserId).toBe("user-99");
  });

  it("promotes a PENDING user to AGENCY_USER on accept", async () => {
    const { service, emailSender, promoteUserToAgencyAccount } = makeService();
    await service.invite({
      agencyId: "agency-5",
      agencyName: "Voyage Test",
      inviter: { id: "owner-1", displayName: "Boss" },
      email: "pending@example.com",
      role: "STAFF"
    });
    const rawToken = new URL(
      emailSender.sendAgencyInvitationEmail.mock.calls.at(-1)?.[0].acceptUrl
    ).searchParams.get("token") ?? "";
    await service.accept({
      rawToken,
      user: { id: "user-pending", emailNormalized: "pending@example.com", accountType: "PENDING" }
    });
    expect(promoteUserToAgencyAccount).toHaveBeenCalledWith("user-pending");
  });

  it("does not call promote for an AGENCY_USER on accept", async () => {
    const { service, emailSender, promoteUserToAgencyAccount } = makeService();
    await service.invite({
      agencyId: "agency-5",
      agencyName: "Voyage Test",
      inviter: { id: "owner-1", displayName: "Boss" },
      email: "agency@example.com",
      role: "STAFF"
    });
    const rawToken = new URL(
      emailSender.sendAgencyInvitationEmail.mock.calls.at(-1)?.[0].acceptUrl
    ).searchParams.get("token") ?? "";
    await service.accept({
      rawToken,
      user: { id: "user-agency", emailNormalized: "agency@example.com", accountType: "AGENCY_USER" }
    });
    expect(promoteUserToAgencyAccount).not.toHaveBeenCalled();
  });

  it("promotes a PERSONAL account to AGENCY_USER when accepting an invitation", async () => {
    const { service, emailSender, addExistingUserToAgency, promoteUserToAgencyAccount } = makeService();
    await service.invite({
      agencyId: "agency-5",
      agencyName: "Voyage Test",
      inviter: { id: "owner-1", displayName: "Boss" },
      email: "personal@example.com",
      role: "STAFF"
    });
    const rawToken = new URL(
      emailSender.sendAgencyInvitationEmail.mock.calls.at(-1)?.[0].acceptUrl
    ).searchParams.get("token") ?? "";
    await service.accept({
      rawToken,
      user: { id: "user-personal", emailNormalized: "personal@example.com", accountType: "PERSONAL" }
    });
    expect(addExistingUserToAgency).toHaveBeenCalled();
    expect(promoteUserToAgencyAccount).toHaveBeenCalledWith("user-personal");
  });

  it("rejects an already-accepted invitation on second lookup", async () => {
    const { service, emailSender } = makeService();
    await service.invite({
      agencyId: "agency-1",
      agencyName: "Voyage Test",
      inviter: { id: "owner-1", displayName: "Boss" },
      email: "once@example.com",
      role: "STAFF"
    });
    const rawToken = new URL(
      emailSender.sendAgencyInvitationEmail.mock.calls.at(-1)?.[0].acceptUrl
    ).searchParams.get("token") ?? "";
    await service.accept({ rawToken, user: { id: "u", emailNormalized: "once@example.com", accountType: "AGENCY_USER" } });
    await expect(service.lookup(rawToken)).rejects.toMatchObject({
      statusCode: 409,
      code: "INVITATION_ALREADY_ACCEPTED"
    });
  });
});

