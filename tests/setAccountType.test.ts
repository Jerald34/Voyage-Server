import { describe, expect, it } from "vitest";
import { createAuthService } from "../src/modules/auth/authService";

function fakeRepo(seed: { accountType?: "PENDING" | "PERSONAL" | "AGENCY_USER" } = {}) {
  const state = { accountType: seed.accountType ?? "PENDING" };
  return {
    state,
    async findUserById() {
      return {
        id: "u-1",
        email: "x@x",
        emailNormalized: "x@x",
        passwordHash: null,
        displayName: "X",
        role: "USER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        accountType: state.accountType
      } as any;
    },
    async updateUser(_id: string, data: any) {
      if (data.accountType) state.accountType = data.accountType;
      return { ...(await this.findUserById()), ...data } as any;
    }
  } as any;
}

describe("authService.setAccountType", () => {
  it("commits PERSONAL from PENDING", async () => {
    const repo = fakeRepo();
    const service = createAuthService({ repository: repo, /* other deps unused */ } as any);
    const result = await service.setAccountType("u-1", "PERSONAL");
    expect(result.accountType).toBe("PERSONAL");
    expect(repo.state.accountType).toBe("PERSONAL");
  });

  it("commits AGENCY_USER from PENDING", async () => {
    const repo = fakeRepo();
    const service = createAuthService({ repository: repo } as any);
    const result = await service.setAccountType("u-1", "AGENCY_USER");
    expect(result.accountType).toBe("AGENCY_USER");
  });

  it("rejects with ACCOUNT_TYPE_ALREADY_SET when already PERSONAL", async () => {
    const repo = fakeRepo({ accountType: "PERSONAL" });
    const service = createAuthService({ repository: repo } as any);
    await expect(service.setAccountType("u-1", "AGENCY_USER")).rejects.toMatchObject({
      statusCode: 409,
      code: "ACCOUNT_TYPE_ALREADY_SET"
    });
  });

  it("rejects with ACCOUNT_TYPE_ALREADY_SET when already AGENCY_USER", async () => {
    const repo = fakeRepo({ accountType: "AGENCY_USER" });
    const service = createAuthService({ repository: repo } as any);
    await expect(service.setAccountType("u-1", "PERSONAL")).rejects.toMatchObject({
      statusCode: 409,
      code: "ACCOUNT_TYPE_ALREADY_SET"
    });
  });

  it("rejects PENDING as a target value", async () => {
    const repo = fakeRepo();
    const service = createAuthService({ repository: repo } as any);
    await expect(service.setAccountType("u-1", "PENDING" as any)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_ACCOUNT_TYPE"
    });
  });
});
