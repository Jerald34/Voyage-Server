import { prisma } from '../src/db/prisma';

async function main() {
  const agencies = await prisma.agency.findMany();
  console.log('Agencies:', JSON.stringify(agencies, null, 2));
  
  const users = await prisma.user.findMany();
  console.log('Users:', JSON.stringify(users, null, 2));

  const members = await prisma.agencyMember.findMany();
  console.log('AgencyMembers:', JSON.stringify(members, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
