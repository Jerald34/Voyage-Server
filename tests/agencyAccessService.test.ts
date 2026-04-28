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
} {
  const accessByAgencyId = new Map<string, AgencyAccess>();

  return {
    accessByAgencyId,
    async findAgencyAccess(userId, agencyId) {
      const access = accessByAgencyId.get(agencyId) ?? null;
      if (!access) {
        return null;
      }

      return {
        agency: access.agency,
        membership: access.membership?.userId === userId ? access.membership : null
      };
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

  it("requires a role included in the allowed roles", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        membership: {
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
