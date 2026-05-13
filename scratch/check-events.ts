import { prisma } from "../src/db/prisma";

async function main() {
  const events = await prisma.agentRunEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, runId: true, threadId: true, type: true, payload: true },
  });

  console.log(`Total events: ${events.length}`);
  for (const e of events) {
    console.log(`  [${e.type}] thread=${e.threadId} run=${e.runId} payload=${JSON.stringify(e.payload)}`);
  }

  const totalEvents = await prisma.agentRunEvent.count();
  console.log(`\nTotal events in DB: ${totalEvents}`);

  const itinEvents = await prisma.agentRunEvent.count({ where: { type: { startsWith: "itinerary" } } });
  console.log(`Itinerary events: ${itinEvents}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
