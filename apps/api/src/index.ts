import { AppError } from "@helmsman/shared";

import { createApp } from "./app.js";
import { getEnv } from "./config.js";

const env = getEnv();
const app = createApp(env);

app.listen(env.port, () => {
  console.log(`Helmsman API is running on port ${env.port}`);
});

process.on("uncaughtException", (error) => {
  const safeError = error instanceof AppError ? error : new AppError("UNCAUGHT_EXCEPTION", "Unhandled error", { error });
  console.error("Uncaught exception", safeError);
});
