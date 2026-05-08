import { PrismaClient, AgencyStatus, MembershipRole, MembershipStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// RAILWAY PUBLIC URL
const connectionString = "postgresql://postgres:WUShUafrvuCNEYbyEtGLdSqSRyZaoKdq@turntable.proxy.rlwy.net:48281/railway";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const userId = "bf22e4b8-d2a0-4bcd-8895-3f3344097f0d"; // RAILWAY USER ID
  const agencyName = "Voyage Travel Agency";
  const agencySlug = "voyage-travel";

  console.log(`Creating agency for user ${userId} on RAILWAY...`);

  // 1. Create the Agency
  const agency = await prisma.agency.create({
    data: {
      name: agencyName,
      slug: agencySlug,
      status: AgencyStatus.VERIFIED,
      ownerUserId: userId,
    },
  });

  console.log(`Agency created on Railway: ${agency.id} (${agency.name})`);

  // 2. Create the Membership
  const membership = await prisma.agencyMembership.create({
    data: {
      agencyId: agency.id,
      userId: userId,
      role: MembershipRole.OWNER,
      status: MembershipStatus.ACTIVE,
    },
  });

  console.log(`Membership created on Railway: ${membership.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
