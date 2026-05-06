/**
 * HTTP-level integration test — simulates the actual browser request through Express.
 * This will catch errors that the service-layer test misses.
 */
import { createApp } from "../src/app";
import http from "node:http";
import { prisma } from "../src/db/prisma";
import { env } from "../src/config/env";

async function main() {
  // Get a raw session token from the database
  // We need to find the actual cookie value. Since we store tokenHash, 
  // we can't reverse it. Instead, let's test the app directly using supertest-like approach.
  const app = createApp();
  const server = http.createServer(app);
  
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://localhost:${addr.port}`;
  console.log(`Test server running on port ${addr.port}\n`);

  // Step 1: Try without auth (should get 401)
  console.log("--- Step 1: POST /agencies/voyage-premium/agent/threads (no auth) ---");
  const r1 = await fetch(`${baseUrl}/agencies/voyage-premium/agent/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const d1 = await r1.json();
  console.log(`Status: ${r1.status} — ${JSON.stringify(d1)}`);

  // Step 2: Create a fresh session token for testing
  console.log("\n--- Step 2: Creating test session ---");
  const user = await prisma.user.findFirst({
    where: { status: "ACTIVE" },
    include: { memberships: true }
  });
  if (!user) {
    console.log("❌ No active user");
    server.close();
    return;
  }
  
  // Generate a test token and session
  const { hashToken } = await import("../src/services/tokens");
  const testToken = "test-agent-flow-" + Date.now();
  const tokenHash = hashToken(testToken);
  
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 86400000)
    }
  });
  console.log(`Created test session: ${session.id}`);

  const cookieHeader = `${env.SESSION_COOKIE_NAME}=${testToken}`;

  // Step 3: Create thread with auth
  console.log("\n--- Step 3: POST /agencies/voyage-premium/agent/threads (with auth) ---");
  try {
    const r2 = await fetch(`${baseUrl}/agencies/voyage-premium/agent/threads`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Cookie": cookieHeader
      },
      body: JSON.stringify({})
    });
    const d2 = await r2.json();
    console.log(`Status: ${r2.status}`);
    console.log(`Response: ${JSON.stringify(d2, null, 2)}`);

    if (r2.ok && d2.thread) {
      const threadId = d2.thread.id;
      
      // Step 4: Send message
      console.log(`\n--- Step 4: POST /agencies/voyage-premium/agent/threads/${threadId}/messages (with auth) ---`);
      const r3 = await fetch(`${baseUrl}/agencies/voyage-premium/agent/threads/${threadId}/messages`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Cookie": cookieHeader
        },
        body: JSON.stringify({ content: "Plan a 5-day trip to Tokyo" })
      });
      const d3 = await r3.json();
      console.log(`Status: ${r3.status}`);
      console.log(`Response: ${JSON.stringify(d3, null, 2)}`);

      if (r3.ok) {
        console.log("\n🎉 Full HTTP flow works!");
      } else {
        console.log(`\n❌ Message send failed: ${d3.error?.message}`);
      }
    } else {
      console.log(`\n❌ Thread creation failed: ${d2.error?.message}`);
    }
  } catch (err) {
    console.error("Request error:", err);
  }

  // Cleanup
  await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
  server.close();
}

main()
  .catch(e => console.error("Script error:", e))
  .finally(() => prisma.$disconnect());
