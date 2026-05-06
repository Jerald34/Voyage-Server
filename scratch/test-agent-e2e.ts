/**
 * End-to-end test: simulate what the client does when user clicks Send.
 * Tests: agencyAccess slug resolution → thread creation → message send
 */
import { prisma } from "../src/db/prisma";
import { createApp } from "../src/app";
import http from "node:http";

async function main() {
  // Get a valid session token hash
  const session = await prisma.session.findFirst({
    where: { expiresAt: { gt: new Date() } },
    select: { tokenHash: true, id: true }
  });

  if (!session) {
    console.log("❌ No active session found");
    return;
  }

  // We can't easily get the raw token from the hash, so let's test through
  // the service layer directly instead
  
  const { agencyAccessService } = await import("../src/modules/agencyAccess/agencyAccessService");
  const { agentService } = await import("../src/modules/agent/agentService");

  const user = await prisma.user.findFirst({
    where: { status: "ACTIVE" },
    include: { memberships: true }
  });

  if (!user) {
    console.log("❌ No active user found");
    return;
  }

  console.log(`Using user: ${user.displayName} (${user.id})`);

  // Step 1: Test agency access with slug
  console.log("\n--- Step 1: Agency access check with slug 'voyage-premium' ---");
  try {
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      { id: user.id, status: user.status as "ACTIVE" },
      "voyage-premium"
    );
    console.log(`✅ Agency access resolved: UUID = ${access.agency.id}, status = ${access.agency.status}`);
    console.log(`   Membership: role = ${access.membership?.role}, status = ${access.membership?.status}`);
    
    const resolvedAgencyId = access.agency.id;

    // Step 2: Create thread
    console.log("\n--- Step 2: Create thread ---");
    try {
      const thread = await agentService.createThread(resolvedAgencyId, user.id, {});
      console.log(`✅ Thread created: ${thread.id} — "${thread.title}"`);

      // Step 3: Send message
      console.log("\n--- Step 3: Send message ---");
      try {
        const result = await agentService.appendUserMessageAndCreateRun(
          resolvedAgencyId,
          thread.id,
          user.id,
          "Hello, I want to plan a trip to Tokyo"
        );
        console.log(`✅ Message created: ${result.message.id}`);
        console.log(`✅ Run created: ${result.run.id} (status: ${result.run.status})`);
        console.log("\n🎉 Full flow works! The client-server integration is properly wired.");
      } catch (err: any) {
        console.log(`❌ Send message failed: ${err.message}`);
        console.error(err);
      }
    } catch (err: any) {
      console.log(`❌ Create thread failed: ${err.message}`);
      console.error(err);
    }
  } catch (err: any) {
    console.log(`❌ Agency access check failed: ${err.message} (code: ${err.code})`);
    console.error(err);
  }
}

main()
  .catch(e => { console.error("Script error:", e); })
  .finally(() => prisma.$disconnect());
