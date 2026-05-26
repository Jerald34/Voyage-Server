import { describe, expect, it } from "vitest";
import {
  createAgencyAccessService,
  type AgencyAccess,
  type AgencyAccessRepository,
  type AgencyAccessUser
} from "../src/modules/agencyAccess/agencyAccessService";

function createUser(overrides: Partial<AgencyAccessUser> = {}): AgencyAccessUser {
  return {
    id: "user-1",
    status: "ACTIVE",
    accountType: "AGENCY_USER",
    ...overrides
  };
}

function createAgencyAccess(overrides: Partial<AgencyAccess> = {}): AgencyAccess {
  return {
    agency: {
      id: "agency-1",
      status: "VERIFIED"
    },
    membership: {
      id: "membership-1",
      agencyId: "agency-1",
      userId: "user-1",
      role: "OWNER",
      status: "ACTIVE"
    },
    ...overrides
  };
}

function createMemoryAgencyAccessRepository(): AgencyAccessRepository & {
  accessByAgencyId: Map<string, AgencyAccess>;
  calls: Array<{ userId: string; agencyId: string }>;
} {
  const accessByAgencyId = new Map<string, AgencyAccess>();
  const calls: Array<{ userId: string; agencyId: string }> = [];

  return {
    accessByAgencyId,
    calls,
    async findAgencyAccess(userId, agencyId) {
      calls.push({ userId, agencyId });
      const access = accessByAgencyId.get(agencyId) ?? null;
      if (!access) {
        return null;
      }

      return {
        agency: access.agency,
        membership: access.membership?.userId === userId ? access.membership : null
      };
    },
    async findTripOrganizer(_agencyId, _tripId) {
      return null;
    }
  };
}

function createService() {
  const repository = createMemoryAgencyAccessRepository();
  const service = createAgencyAccessService({ repository });
  return { service, repository };
}

describe("agency access service", () => {
  it("blocks disabled users before loading agency access", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess());

    await expect(
      service.requireVerifiedAgencyMember(createUser({ status: "DISABLED" }), "agency-1")
    ).rejects.toMatchObject({
      code: "USER_DISABLED",
      statusCode: 403,
      message: "This account is disabled."
    });
    expect(repository.calls).toEqual([]);
  });

  it("requires the agency to exist", async () => {
    const { service } = createService();

    await expect(service.requireVerifiedAgencyMember(createUser(), "missing-agency")).rejects.toMatchObject({
      code: "AGENCY_NOT_FOUND",
      statusCode: 404,
      message: "Agency not found."
    });
  });

  it("requires a verified agency", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        agency: {
          id: "agency-1",
          status: "PENDING_REVIEW"
        }
      })
    );

    await expect(service.requireVerifiedAgencyMember(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_NOT_VERIFIED",
      statusCode: 403,
      message: "Agency must be verified before using itinerary agent features."
    });
  });

  it("requires an active membership", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        membership: {
          id: "membership-1",
          agencyId: "agency-1",
          userId: "user-1",
          role: "ADMIN",
          status: "DISABLED"
        }
      })
    );

    await expect(service.requireVerifiedAgencyMember(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_ACCESS_REQUIRED",
      statusCode: 403,
      message: "You do not have access to this agency workspace."
    });
  });

  it("requires the user to belong to the agency", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess());

    await expect(service.requireVerifiedAgencyMember(createUser({ id: "other-user" }), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_ACCESS_REQUIRED",
      statusCode: 403,
      message: "You do not have access to this agency workspace."
    });
  });

  it("requires a role included in the allowed roles", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        membership: {
          id: "membership-1",
          agencyId: "agency-1",
          userId: "user-1",
          role: "STAFF",
          status: "ACTIVE"
        }
      })
    );

    await expect(service.requireVerifiedAgencyMember(createUser(), "agency-1", ["OWNER", "ADMIN"])).rejects.toMatchObject({
      code: "AGENCY_ACCESS_REQUIRED",
      statusCode: 403
    });
  });

  it.each(["OWNER", "ADMIN", "STAFF"] as const)("returns active %s access for verified agencies by default", async (role) => {
    const { service, repository } = createService();
    const access = createAgencyAccess({
      membership: {
        agencyId: "agency-1",
        userId: "user-1",
        role,
        status: "ACTIVE"
      }
    });
    repository.accessByAgencyId.set("agency-1", access);

    await expect(service.requireVerifiedAgencyMember(createUser(), "agency-1")).resolves.toEqual(access);
  });
});

describe("requireAgencyOwner", () => {
  it("returns access for an OWNER member", async () => {
    const { service, repository } = createService();
    const access = createAgencyAccess({
      membership: { id: "membership-1", agencyId: "agency-1", userId: "user-1", role: "OWNER", status: "ACTIVE" }
    });
    repository.accessByAgencyId.set("agency-1", access);
    await expect(service.requireAgencyOwner(createUser(), "agency-1")).resolves.toEqual(access);
  });

  it("rejects an ADMIN member with AGENCY_OWNER_REQUIRED", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        membership: { id: "membership-1", agencyId: "agency-1", userId: "user-1", role: "ADMIN", status: "ACTIVE" }
      })
    );
    await expect(service.requireAgencyOwner(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_OWNER_REQUIRED",
      statusCode: 403
    });
  });

  it("rejects a STAFF member with AGENCY_OWNER_REQUIRED", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        membership: { id: "membership-1", agencyId: "agency-1", userId: "user-1", role: "STAFF", status: "ACTIVE" }
      })
    );
    await expect(service.requireAgencyOwner(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_OWNER_REQUIRED",
      statusCode: 403
    });
  });
});

describe("requireAgencyAdmin", () => {
  it.each(["OWNER", "ADMIN"] as const)("returns access for a(n) %s member", async (role) => {
    const { service, repository } = createService();
    const access = createAgencyAccess({
      membership: { id: "membership-1", agencyId: "agency-1", userId: "user-1", role, status: "ACTIVE" }
    });
    repository.accessByAgencyId.set("agency-1", access);
    await expect(service.requireAgencyAdmin(createUser(), "agency-1")).resolves.toEqual(access);
  });

  it("rejects a STAFF member with AGENCY_ADMIN_REQUIRED", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        membership: { id: "membership-1", agencyId: "agency-1", userId: "user-1", role: "STAFF", status: "ACTIVE" }
      })
    );
    await expect(service.requireAgencyAdmin(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_ADMIN_REQUIRED",
      statusCode: 403
    });
  });
});

function withTripOrganizer(
  repo: ReturnType<typeof createMemoryAgencyAccessRepository>,
  tripId: string,
  organizerUserId: string | null
) {
  (repo as any).findTripOrganizer = async (_agencyId: string, _tripId: string) => {
    if (_tripId !== tripId) return null;
    return { assignedOrganizerUserId: organizerUserId };
  };
}

describe("requireTripAccess", () => {
  it("allows OWNER access to any trip in the agency", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess());
    withTripOrganizer(repository, "trip-1", "other-staff");
    await expect(service.requireTripAccess(createUser(), "agency-1", "trip-1")).resolves.toBeDefined();
  });

  it("allows ADMIN access to any trip in the agency", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess({
      membership: { id: "membership-1", agencyId: "agency-1", userId: "user-1", role: "ADMIN", status: "ACTIVE" }
    }));
    withTripOrganizer(repository, "trip-1", "other-staff");
    await expect(service.requireTripAccess(createUser(), "agency-1", "trip-1")).resolves.toBeDefined();
  });

  it("allows STAFF to access their own trip", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess({
      membership: { id: "membership-1", agencyId: "agency-1", userId: "user-1", role: "STAFF", status: "ACTIVE" }
    }));
    withTripOrganizer(repository, "trip-1", "user-1");
    await expect(service.requireTripAccess(createUser(), "agency-1", "trip-1")).resolves.toBeDefined();
  });

  it("returns 404 (not 403) when STAFF probes another organizer's trip", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess({
      membership: { id: "membership-1", agencyId: "agency-1", userId: "user-1", role: "STAFF", status: "ACTIVE" }
    }));
    withTripOrganizer(repository, "trip-1", "other-staff");
    await expect(service.requireTripAccess(createUser(), "agency-1", "trip-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "TRIP_NOT_FOUND"
    });
  });

  it("returns 404 when the trip does not exist at all", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess({
      membership: { id: "membership-1", agencyId: "agency-1", userId: "user-1", role: "STAFF", status: "ACTIVE" }
    }));
    // no withTripOrganizer call — repo returns null
    (repository as any).findTripOrganizer = async () => null;
    await expect(service.requireTripAccess(createUser(), "agency-1", "missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "TRIP_NOT_FOUND"
    });
  });
});

describe("account type gates", () => {
  it("rejects PERSONAL users with ACCOUNT_TYPE_FORBIDS_AGENCY before loading agency access", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess());
    await expect(
      service.requireVerifiedAgencyMember(createUser({ accountType: "PERSONAL" }), "agency-1")
    ).rejects.toMatchObject({
      code: "ACCOUNT_TYPE_FORBIDS_AGENCY",
      statusCode: 403
    });
  });

  it("rejects PENDING users with ACCOUNT_TYPE_PENDING before loading agency access", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess());
    await expect(
      service.requireVerifiedAgencyMember(createUser({ accountType: "PENDING" }), "agency-1")
    ).rejects.toMatchObject({
      code: "ACCOUNT_TYPE_PENDING",
      statusCode: 403
    });
  });
});
