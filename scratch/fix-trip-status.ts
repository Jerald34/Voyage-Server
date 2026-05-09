import { prisma } from "../src/db/prisma";

async function main() {
  const result = await prisma.clientTrip.updateMany({
    where: {
      status: "DRAFT",
      clientName: { not: null },
      agentThreads: { some: {} },
    },
    data: {
      status: "APPROVED_INTERNAL",
    },
  });

  console.log(`Updated ${result.count} trips from DRAFT to APPROVED_INTERNAL`);

  const trips = await prisma.clientTrip.findMany({
    where: { status: "APPROVED_INTERNAL" },
    select: { id: true, clientName: true, destinationSummary: true, status: true },
  });

  for (const t of trips) {
    console.log(`  [${t.status}] ${t.clientName} — ${t.destinationSummary}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
