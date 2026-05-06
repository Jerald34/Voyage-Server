import { describe, expect, it } from "vitest";
import {
  createAgencyService,
  type AgencyRepository,
  type AgencyUser
} from "../src/modules/agencies/agencyService";

function createUser(overrides: Partial<AgencyUser> = {}): AgencyUser {
  return {
    id: "user-1",
    role: "USER",
    status: "ACTIVE",
    emailVerifiedAt: new Date("2026-04-27T00:00:00.000Z"),
    ...overrides
  };
}

function createMemoryAgencyRepository(): AgencyRepository & {
  agencies: Awaited<ReturnType<AgencyRepository["createAgency"]>>[];
  memberships: Awaited<ReturnType<AgencyRepository["createOwnerMembership"]>>[];
  audits: Awaited<ReturnType<AgencyRepository["createAdminAuditEvent"]>>[];
} {
  const agencies: Awaited<ReturnType<AgencyRepository["createAgency"]>>[] = [];
  const memberships: Awaited<ReturnType<AgencyRepository["createOwnerMembership"]>>[] = [];
  const audits: Awaited<ReturnType<AgencyRepository["createAdminAuditEvent"]>>[] = [];

  return {
    agencies,
    memberships,
    audits,
    async createAgency(data) {
      const agency = {
        id: `agency-${agencies.length + 1}`,
        status: "PENDING_REVIEW" as const,
        submittedAt: new Date("2026-04-27T12:00:00.000Z"),
        verifiedAt: null,
        verifiedByAdminUserId: null,
        rejectedAt: null,
        rejectedByAdminUserId: null,
        rejectionReason: null,
        suspendedAt: null,
        suspendedByAdminUserId: null,
        suspensionReason: null,
        ...data
      };
      agencies.push(agency);
      return agency;
    },
    async createOwnerMembership(data) {
      const membership = {
        id: `membership-${memberships.length + 1}`,
        role: "OWNER" as const,
        status: "ACTIVE" as const,
        ...data
      };
      memberships.push(membership);
      return membership;
    },
    async listPendingAgencies() {
      return agencies.filter((agency) => agency.status === "PENDING_REVIEW");
    },
    async findAgencyById(id) {
      return agencies.find((agency) => agency.id === id) ?? null;
    },
    async updateAgency(id, data) {
      const agency = agencies.find((candidate) => candidate.id === id);
      if (!agency) {
        throw new Error(`Missing agency ${id}`);
      }
      Object.assign(agency, data);
      return agency;
    },
    async createAdminAuditEvent(data) {
      const audit = {
        id: `audit-${audits.length + 1}`,
        createdAt: new Date("2026-04-27T12:00:00.000Z"),
        ...data
      };
      audits.push(audit);
      return audit;
    }
  };
}

function createService() {
  const repository = createMemoryAgencyRepository();
  const service = createAgencyService({
    repository,
    now: () => new Date("2026-04-27T12:00:00.000Z")
  });
  return { service, repository };
}

describe("agency service", () => {
  it("blocks unverified users from agency registration", async () => {
    const { service } = createService();

    await expect(
      service.createAgencyApplication(createUser({ emailVerifiedAt: null }), {
        name: "Unverified Travel"
      })
    ).rejects.toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
      statusCode: 403
    });
  });

  it("creates pending agency and owner membership for verified users", async () => {
    const { service, repository } = createService();

    const agency = await service.createAgencyApplication(createUser({ id: "owner-1" }), {
      name: "North Star Travel"
    });

    expect(agency).toMatchObject({
      name: "North Star Travel",
      slug: "north-star-travel",
      ownerUserId: "owner-1",
      status: "PENDING_REVIEW"
    });
    expect(repository.memberships[0]).toMatchObject({
      agencyId: agency.id,
      userId: "owner-1",
      role: "OWNER",
      status: "ACTIVE"
    });
  });

  it("requires platform admin to list pending agencies", async () => {
    const { service } = createService();

    await expect(service.listPendingAgencies(createUser())).rejects.toMatchObject({
      code: "ADMIN_REQUIRED",
      statusCode: 403
    });
  });

  it("allows admin to approve an agency and audit the decision", async () => {
    const { service, repository } = createService();
    const agency = await service.createAgencyApplication(createUser({ id: "owner-1" }), {
      name: "Review Travel"
    });

    const approved = await service.approveAgency(createUser({ id: "admin-1", role: "ADMIN" }), agency.id);

    expect(approved).toMatchObject({
      id: agency.id,
      status: "VERIFIED",
      verifiedByAdminUserId: "admin-1",
      verifiedAt: new Date("2026-04-27T12:00:00.000Z")
    });
    expect(repository.audits[0]).toMatchObject({
      adminUserId: "admin-1",
      action: "AGENCY_APPROVED",
      targetType: "Agency",
      targetId: agency.id
    });
  });

  it("allows admin to reject an agency with a reason", async () => {
    const { service } = createService();
    const agency = await service.createAgencyApplication(createUser(), {
      name: "Reject Travel"
    });

    const rejected = await service.rejectAgency(createUser({ id: "admin-1", role: "ADMIN" }), agency.id, {
      reason: "Business details could not be verified."
    });

    expect(rejected).toMatchObject({
      status: "REJECTED",
      rejectedByAdminUserId: "admin-1",
      rejectionReason: "Business details could not be verified."
    });
  });

  it("allows admin to suspend an agency with a reason", async () => {
    const { service } = createService();
    const agency = await service.createAgencyApplication(createUser(), {
      name: "Suspend Travel"
    });

    const suspended = await service.suspendAgency(createUser({ id: "admin-1", role: "ADMIN" }), agency.id, {
      reason: "Policy review required."
    });

    expect(suspended).toMatchObject({
      status: "SUSPENDED",
      suspendedByAdminUserId: "admin-1",
      suspensionReason: "Policy review required."
    });
  });
});
