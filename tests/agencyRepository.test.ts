import { describe, expect, it, vi } from "vitest";
import { createPrismaAgencyRepository } from "../src/modules/agencies/agencyRepository";

describe("agency repository: listActiveSuperAdmins", () => {
  it("lists active super admins with only the fields an email needs", async () => {
    const admins = [{ id: "admin-1", email: "admin@voyage.test", displayName: "Ada" }];
    const findMany = vi.fn().mockResolvedValue(admins);
    const repository = createPrismaAgencyRepository({ user: { findMany } } as never);

    await expect(repository.listActiveSuperAdmins()).resolves.toEqual(admins);
    expect(findMany).toHaveBeenCalledWith({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      select: { id: true, email: true, displayName: true }
    });
  });
});
