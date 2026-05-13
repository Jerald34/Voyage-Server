import { prisma } from "../src/db/prisma";

async function main() {
  const events = await prisma.agentRunEvent.groupBy({
    by: ["type"],
    where: { type: { startsWith: "itinerary" } },
    _count: true,
  });
  console.log("Itinerary event types:");
  for (const e of events) {
    console.log(`  ${e.type}: ${e._count}`);
  }

  const created = await prisma.agentRunEvent.findMany({
    where: { type: "itinerary.created" },
    select: { threadId: true, payload: true },
    take: 5,
  });
  console.log("\nitinerary.created events:");
  for (const e of created) {
    const p = e.payload as Record<string, unknown>;
    console.log(`  thread=${e.threadId} itineraryId=${p.itineraryId}`);
  }

  const updated = await prisma.agentRunEvent.findMany({
    where: { type: "itinerary.updated" },
    select: { threadId: true, payload: true },
    take: 5,
  });
  console.log("\nitinerary.updated events:");
  for (const e of updated) {
    const p = e.payload as Record<string, unknown>;
    console.log(`  thread=${e.threadId} itineraryId=${p.itineraryId}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
