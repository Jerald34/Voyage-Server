import { prisma } from "../src/db/prisma";

async function main() {
  const trips = await prisma.clientTrip.findMany({
    include: {
      itineraries: { select: { id: true, status: true, version: true } },
      agentThreads: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total trips: ${trips.length}`);
  for (const t of trips) {
    console.log(
      `  [${t.status}] ${t.clientName ?? "(no name)"} — ${t.destinationSummary ?? "(no dest)"} — ${t.itineraries.length} itin, ${t.agentThreads.length} threads`
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
