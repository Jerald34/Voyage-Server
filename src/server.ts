import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`Voyage server listening on port ${env.PORT}`);
  console.log("!!! SERVER_RESTARTED_WITH_NEW_LOGS !!!");
});
