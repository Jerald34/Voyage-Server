/**
 * Test script to trace the agent flow end-to-end.
 * Run: npx tsx scratch/test-agent-flow.ts
 */
import { prisma } from "../src/db/prisma";

async function main() {
  console.log("=== Testing Agent Flow ===\n");

  // 1. Check if agency with slug "voyage-premium" exists
  console.log("1. Looking up agency by slug 'voyage-premium'...");
  const agency = await prisma.agency.findUnique({
    where: { slug: "voyage-premium" },
    select: { id: true, slug: true, status: true, name: true }
  });
  
  if (!agency) {
    console.log("   ❌ No agency found with slug 'voyage-premium'");
    console.log("\n   Listing all agencies:");
    const allAgencies = await prisma.agency.findMany({
      select: { id: true, slug: true, status: true, name: true }
    });
    if (allAgencies.length === 0) {
      console.log("   ❌ No agencies exist in the database at all!");
    } else {
      for (const a of allAgencies) {
        console.log(`   - ${a.name} (slug: ${a.slug}, status: ${a.status}, id: ${a.id})`);
      }
    }
    return;
  }

  console.log(`   ✅ Found: ${agency.name} (id: ${agency.id}, status: ${agency.status})`);

  // 2. Check if agency is verified
  if (agency.status !== "VERIFIED") {
    console.log(`   ⚠️  Agency status is '${agency.status}', not 'VERIFIED'. Agent routes will reject requests.`);
  }

  // 3. Check memberships
  console.log("\n2. Checking memberships...");
  const memberships = await prisma.agencyMembership.findMany({
    where: { agencyId: agency.id },
    include: { user: { select: { id: true, email: true, displayName: true, status: true } } }
  });
  
  if (memberships.length === 0) {
    console.log("   ❌ No memberships found for this agency!");
  } else {
    for (const m of memberships) {
      console.log(`   - ${m.user.displayName} (${m.user.email}) — role: ${m.role}, status: ${m.status}, user status: ${m.user.status}`);
    }
  }

  // 4. Check active sessions
  console.log("\n3. Checking active sessions...");
  const sessions = await prisma.session.findMany({
    where: { expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, email: true, displayName: true } } },
    take: 5
  });
  
  if (sessions.length === 0) {
    console.log("   ❌ No active sessions! User must be logged in for agent routes to work.");
  } else {
    for (const s of sessions) {
      console.log(`   - ${s.user.displayName} (${s.user.email}) — session expires: ${s.expiresAt}`);
      
      // Check if this user has membership in the agency
      const hasMembership = memberships.some(m => m.userId === s.user.id);
      if (!hasMembership) {
        console.log(`     ⚠️  This user has NO membership in the voyage-premium agency!`);
      } else {
        console.log(`     ✅ This user has a membership in the agency`);
      }
    }
  }

  // 5. Check existing agent threads
  console.log("\n4. Checking existing agent threads...");
  const threads = await prisma.agentThread.findMany({
    where: { agencyId: agency.id },
    select: { id: true, title: true, status: true, createdAt: true },
    take: 5
  });
  
  if (threads.length === 0) {
    console.log("   No threads yet (expected for fresh setup)");
  } else {
    for (const t of threads) {
      console.log(`   - ${t.title} (id: ${t.id}, status: ${t.status})`);
    }
  }

  console.log("\n=== Done ===");
}

main()
  .catch(e => { console.error("Script error:", e); })
  .finally(() => prisma.$disconnect());
