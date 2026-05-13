import { prisma } from '../src/db/prisma';

async function main() {
  const userId = '8cd7d782-8bf3-446d-8a7c-8c661b001024';

  console.log(`Promoting user ${userId} to ADMIN...`);
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { role: 'ADMIN' },
  });
  console.log(`User ${updatedUser.emailNormalized} is now ${updatedUser.role}.`);

  console.log(`Finding agencies owned by user ${userId}...`);
  const agencies = await prisma.agency.findMany({
    where: { ownerUserId: userId },
  });

  if (agencies.length === 0) {
    console.log('No agencies found for this user.');
  } else {
    for (const agency of agencies) {
      console.log(`Verifying agency: ${agency.name} (${agency.id})...`);
      await prisma.agency.update({
        where: { id: agency.id },
        data: {
          status: 'VERIFIED',
          verifiedAt: new Date(),
          verifiedByAdminUserId: userId,
        },
      });
      console.log(`Agency ${agency.name} verified.`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
