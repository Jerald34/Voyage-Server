import { prisma } from "../src/db/prisma";

async function main() {
  const threads = await prisma.agentThread.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      tripId: true,
      agencyId: true,
      runs: {
        select: {
          id: true,
          events: {
            where: { type: "itinerary.updated" },
            select: { type: true, payload: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
    take: 5,
  });

  for (const t of threads) {
    const allEvents = t.runs.flatMap((r) => r.events);
    console.log(`Thread: ${t.id} | title: "${t.title}" | tripId: ${t.tripId}`);
    console.log(`  itinerary.updated events: ${allEvents.length}`);
    for (const e of allEvents) {
      console.log(`    payload: ${JSON.stringify(e.payload)}`);
    }
  }

  // Also check itineraries
  const itineraries = await prisma.itinerary.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, tripId: true, status: true, version: true, title: true },
    take: 5,
  });
  console.log("\nRecent itineraries:");
  for (const i of itineraries) {
    console.log(`  [${i.status}] ${i.id} — trip: ${i.tripId} — v${i.version} — "${i.title}"`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
