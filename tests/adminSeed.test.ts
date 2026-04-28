import { describe, expect, it } from "vitest";
import {
  parseAdminEmails,
  promoteAdminEmails,
  type AdminSeedRepository
} from "../prisma/seed";

describe("admin seed", () => {
  it("parses configured admin emails into normalized unique values", () => {
    expect(parseAdminEmails(" Admin@Example.com, admin@example.com, OWNER@example.com ")).toEqual([
      "admin@example.com",
      "owner@example.com"
    ]);
  });

  it("promotes matching users and writes audit events", async () => {
    const promoted: string[] = [];
    const audits: Array<{ adminUserId: string; targetId: string }> = [];
    const repository: AdminSeedRepository = {
      async findUserByEmailNormalized(emailNormalized) {
        if (emailNormalized !== "admin@example.com") {
          return null;
        }
        return {
          id: "user-1",
          emailNormalized,
          role: "USER"
        };
      },
      async promoteUserToAdmin(userId) {
        promoted.push(userId);
      },
      async createAdminAuditEvent(data) {
        audits.push({ adminUserId: data.adminUserId, targetId: data.targetId });
      }
    };

    const result = await promoteAdminEmails(repository, ["admin@example.com", "missing@example.com"]);

    expect(result).toEqual({ promoted: ["admin@example.com"], missing: ["missing@example.com"] });
    expect(promoted).toEqual(["user-1"]);
    expect(audits).toEqual([{ adminUserId: "user-1", targetId: "user-1" }]);
  });
});
