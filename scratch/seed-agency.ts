import { prisma } from '../src/db/prisma';

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'deverajerald0@gmail.com' }
  });

  if (!user) {
    console.error('User not found. Please register first.');
    return;
  }

  const agencySlug = 'voyage-premium';
  
  const agency = await prisma.agency.upsert({
    where: { slug: agencySlug },
    update: {},
    create: {
      name: 'Voyage Premium Agency',
      slug: agencySlug,
      status: 'VERIFIED',
      ownerUserId: user.id
    }
  });

  console.log('Agency created/verified:', agency.id);

  const membership = await prisma.agencyMembership.upsert({
    where: {
      agencyId_userId: {
        agencyId: agency.id,
        userId: user.id
      }
    },
    update: {},
    create: {
      agencyId: agency.id,
      userId: user.id,
      role: 'OWNER',
      status: 'ACTIVE'
    }
  });

  console.log('User added as OWNER to agency:', membership.agencyId);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
