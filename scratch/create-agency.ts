import { PrismaClient, AgencyStatus, MembershipRole, MembershipStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const userId = "1b9775cf-467e-4386-913c-fc54edf8f60e";
  const agencyName = "Voyage Travel Agency";
  const agencySlug = "voyage-travel";

  console.log(`Creating agency for user ${userId}...`);

  // 1. Create the Agency
  const agency = await prisma.agency.create({
    data: {
      name: agencyName,
      slug: agencySlug,
      status: AgencyStatus.VERIFIED,
      ownerUserId: userId,
    },
  });

  console.log(`Agency created: ${agency.id} (${agency.name})`);

  // 2. Create the Membership
  const membership = await prisma.agencyMembership.create({
    data: {
      agencyId: agency.id,
      userId: userId,
      role: MembershipRole.OWNER,
      status: MembershipStatus.ACTIVE,
    },
  });

  console.log(`Membership created: ${membership.id}`);
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
