import { prisma } from "../src/db/prisma";

export type AdminSeedUser = {
  id: string;
  emailNormalized: string;
  role: "USER" | "ADMIN";
};

export type AdminSeedRepository = {
  findUserByEmailNormalized(emailNormalized: string): Promise<AdminSeedUser | null>;
  promoteUserToAdmin(userId: string): Promise<void>;
  createAdminAuditEvent(data: {
    adminUserId: string;
    action: "USER_PROMOTED_TO_ADMIN";
    targetType: "User";
    targetId: string;
    reason: string;
  }): Promise<void>;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function parseAdminEmails(input: string) {
  return [...new Set(input.split(",").map(normalizeEmail).filter(Boolean))];
}

export async function promoteAdminEmails(repository: AdminSeedRepository, adminEmails: string[]) {
  const promoted: string[] = [];
  const missing: string[] = [];

  for (const email of adminEmails) {
    const user = await repository.findUserByEmailNormalized(email);
    if (!user) {
      missing.push(email);
      continue;
    }

    if (user.role !== "ADMIN") {
      await repository.promoteUserToAdmin(user.id);
      await repository.createAdminAuditEvent({
        adminUserId: user.id,
        action: "USER_PROMOTED_TO_ADMIN",
        targetType: "User",
        targetId: user.id,
        reason: "ADMIN_EMAILS seed bootstrap"
      });
    }

    promoted.push(email);
  }

  return { promoted, missing };
}

export function createPrismaAdminSeedRepository(): AdminSeedRepository {
  return {
    async findUserByEmailNormalized(emailNormalized) {
      return prisma.user.findUnique({
        where: { emailNormalized },
        select: {
          id: true,
          emailNormalized: true,
          role: true
        }
      });
    },
    async promoteUserToAdmin(userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { role: "ADMIN" }
      });
    },
    async createAdminAuditEvent(data) {
      await prisma.adminAuditEvent.create({ data: data as never });
    }
  };
}

async function main() {
  const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS ?? "");
  if (adminEmails.length === 0) {
    console.info("No ADMIN_EMAILS configured. Skipping admin seed.");
    return;
  }

  const result = await promoteAdminEmails(createPrismaAdminSeedRepository(), adminEmails);
  console.info(`Admin seed promoted: ${result.promoted.join(", ") || "none"}`);

  if (result.missing.length > 0) {
    console.info(`Admin seed missing users: ${result.missing.join(", ")}`);
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
