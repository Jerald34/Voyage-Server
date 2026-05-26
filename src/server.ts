import { createApp } from "./app";
import { env } from "./config/env";
import { prepareGoogleApplicationCredentials } from "./config/googleCredentials";
import { initReviewScheduler } from "./modules/reviews/reviewScheduler";

prepareGoogleApplicationCredentials();

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`Voyage server listening on port ${env.PORT}`);
  console.log("!!! SERVER_RESTARTED_WITH_NEW_LOGS !!!");
  if (env.REVIEW_SCHEDULER_ENABLED) {
    initReviewScheduler();
  }
});
