import { createApp } from "./app";
import { env } from "./config/env";
import { prepareGoogleApplicationCredentials } from "./config/googleCredentials";
import { initializeRateLimiterStoreLifecycle } from "./http/rateLimiters";
import { initReviewScheduler } from "./modules/reviews/reviewScheduler";

const googleCredentials = prepareGoogleApplicationCredentials();

process.once("exit", () => {
  googleCredentials?.cleanup();
});

function closeServer(server: import("node:http").Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function main() {
  const rateLimiterStores = await initializeRateLimiterStoreLifecycle();

  try {
    const app = createApp({ rateLimiterStoreFactory: rateLimiterStores.storeFactory });
    const server = app.listen(env.PORT, () => {
      console.log(`Voyage server listening on port ${env.PORT}`);
      console.log("!!! SERVER_RESTARTED_WITH_NEW_LOGS !!!");
      if (env.REVIEW_SCHEDULER_ENABLED) {
        initReviewScheduler();
      }
    });

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = (signal: NodeJS.Signals) => {
      if (!shutdownPromise) {
        shutdownPromise = (async () => {
          console.log(`[server] Shutting down after ${signal}`);
          try {
            const results = await Promise.allSettled([
              closeServer(server),
              rateLimiterStores.close()
            ]);
            const rejectedResult = results.find(
              (result): result is PromiseRejectedResult => result.status === "rejected"
            );

            if (rejectedResult) {
              throw rejectedResult.reason;
            }
          } finally {
            googleCredentials?.cleanup();
          }
        })();
      }

      return shutdownPromise;
    };

    process.once("SIGINT", () => {
      void shutdown("SIGINT")
        .then(() => {
          process.exit(0);
        })
        .catch((error) => {
          console.error("[server] Shutdown failed", error);
          process.exit(1);
        });
    });

    process.once("SIGTERM", () => {
      void shutdown("SIGTERM")
        .then(() => {
          process.exit(0);
        })
        .catch((error) => {
          console.error("[server] Shutdown failed", error);
          process.exit(1);
        });
    });
  } catch (error) {
    await rateLimiterStores.close();
    throw error;
  }
}

void main().catch((error) => {
  console.error("[server] Failed to start", error);
  process.exit(1);
});
