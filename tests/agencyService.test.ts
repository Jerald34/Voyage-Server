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
    async findMembership(agencyId, userId) {
      return memberships.find((membership) => membership.agencyId === agencyId && membership.userId === userId) ?? null;
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
        name: "Unverified Travel",
        businessPhone: "+63 900 111 2222",
        businessEmail: "owner@example.com",
        city: "Subic",
        country: "Philippines"
      })
    ).rejects.toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
      statusCode: 403
    });
  });

  it("creates pending agency and owner membership for verified users", async () => {
    const { service, repository } = createService();

    const agency = await service.createAgencyApplication(createUser({ id: "owner-1" }), {
      name: "North Star Travel",
      businessPhone: "+63 900 111 2222",
      businessEmail: "owner@example.com",
      city: "Subic",
      country: "Philippines"
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
      name: "Review Travel",
      businessPhone: "+63 900 111 2222",
      businessEmail: "owner@example.com",
      city: "Subic",
      country: "Philippines"
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
      name: "Reject Travel",
      businessPhone: "+63 900 111 2222",
      businessEmail: "owner@example.com",
      city: "Subic",
      country: "Philippines"
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
      name: "Suspend Travel",
      businessPhone: "+63 900 111 2222",
      businessEmail: "owner@example.com",
      city: "Subic",
      country: "Philippines"
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

  it("owner can update workspace settings without changing slug", async () => {
    const { service, repository } = createService();
    const owner = createUser({ id: "owner-1" });
    const agency = await service.createAgencyApplication(owner, {
      name: "Original Travel",
      businessPhone: "+63 900 111 2222",
      businessEmail: "owner@example.com",
      city: "Subic",
      country: "Philippines"
    });

    const updated = await service.updateAgencySettings(owner, agency.id, {
      name: "Updated Travel",
      businessPhone: "+63 900 333 4444",
      businessEmail: "hello@example.com",
      city: "Olongapo City",
      country: "Philippines"
    });

    expect(updated).toMatchObject({
      id: agency.id,
      name: "Updated Travel",
      slug: "original-travel",
      businessPhone: "+63 900 333 4444",
      businessEmail: "hello@example.com",
      city: "Olongapo City",
      country: "Philippines"
    });
    expect(repository.audits).toHaveLength(0);
  });

  it("non-owner member gets ApiError 403 AGENCY_OWNER_REQUIRED", async () => {
    const { service, repository } = createService();
    const agency = await service.createAgencyApplication(createUser({ id: "owner-1" }), {
      name: "Owner Travel",
      businessPhone: "+63 900 111 2222",
      businessEmail: "owner@example.com",
      city: "Subic",
      country: "Philippines"
    });
    repository.memberships.push({
      id: "membership-2",
      agencyId: agency.id,
      userId: "staff-1",
      role: "STAFF",
      status: "ACTIVE"
    });

    await expect(
      service.updateAgencySettings(createUser({ id: "staff-1" }), agency.id, {
        name: "Staff Travel",
        businessPhone: "+63 900 333 4444",
        businessEmail: "hello@example.com",
        city: "Olongapo City",
        country: "Philippines"
      })
    ).rejects.toMatchObject({
      code: "AGENCY_OWNER_REQUIRED",
      statusCode: 403
    });
  });

  it("disabled owner membership gets ApiError 403 AGENCY_OWNER_REQUIRED", async () => {
    const { service, repository } = createService();
    const owner = createUser({ id: "owner-1" });
    const agency = await service.createAgencyApplication(owner, {
      name: "Disabled Owner Travel",
      businessPhone: "+63 900 111 2222",
      businessEmail: "owner@example.com",
      city: "Subic",
      country: "Philippines"
    });
    repository.memberships[0].status = "DISABLED";

    await expect(
      service.updateAgencySettings(owner, agency.id, {
        name: "Disabled Owner Update",
        businessPhone: "+63 900 333 4444",
        businessEmail: "hello@example.com",
        city: "Olongapo City",
        country: "Philippines"
      })
    ).rejects.toMatchObject({
      code: "AGENCY_OWNER_REQUIRED",
      statusCode: 403
    });
  });
});
