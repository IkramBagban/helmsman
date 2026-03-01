import { AppError } from "@helmsman/shared";

import { createApp } from "./app.js";
import { getEnv } from "./config.js";

const env = getEnv();

// Bridge env vars for @ai-sdk/google which reads GOOGLE_GENERATIVE_AI_API_KEY directly.
// Users may have GEMINI_API_KEY or GOOGLE_API_KEY set instead — ensure the SDK finds it.
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && env.geminiApiKey) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = env.geminiApiKey;
}

const bootstrap = async (): Promise<void> => {
  const app = await createApp(env);

  app.listen(env.port, () => {
    console.log(`Helmsman API is running on port ${env.port}`);
  });
};

bootstrap().catch((error) => {
  console.error("Failed to start Helmsman API", error);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  const safeError = error instanceof AppError ? error : new AppError("UNCAUGHT_EXCEPTION", "Unhandled error", { error });
  console.error("Uncaught exception", safeError);
});
