import express from "express";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { Redis } from "ioredis";

import type { ApiEnv } from "./config.js";
import { correlationIdMiddleware, CORRELATION_ID_HEADER } from "./middleware/correlation-id.js";
import { errorHandlerMiddleware } from "./middleware/error-handler.js";
import { requestLoggingMiddleware } from "./middleware/request-logging.js";
import { handleHealthRequest } from "./routes/health.js";
import {
  createTelegramWebhookHandler,
  type TelegramWebhookDependencies,
  type TelegramWebhookHandler,
} from "./routes/telegram.js";
import { InMemoryDedupStore, RedisDedupStore } from "./telegram/dedup.js";

export interface ApiAppDependencies {
  readonly telegram?: TelegramWebhookDependencies;
  readonly telegramWebhookHandler?: TelegramWebhookHandler;
}

const toHeaderEntries = (request: ExpressRequest, response: ExpressResponse): [string, string][] => {
  const entries = Object.entries(request.headers).flatMap(([key, value]) => {
    if (typeof value === "string") {
      return [[key, value] as [string, string]];
    }

    if (Array.isArray(value)) {
      return value.map((item) => [key, item] as [string, string]);
    }

    return [] as [string, string][];
  });

  const hasCorrelationId = entries.some(([key]) => key.toLowerCase() === CORRELATION_ID_HEADER);
  if (!hasCorrelationId && typeof response.locals.correlationId === "string") {
    entries.push([CORRELATION_ID_HEADER, response.locals.correlationId as string]);
  }

  return entries;
};

export const createApp = async (env: ApiEnv, dependencies?: ApiAppDependencies): Promise<express.Express> => {
  const app = express();

  let telegramDeps = dependencies?.telegram;
  if (!telegramDeps?.dedupStore) {
    if (env.redisUrl) {
      const redis = new Redis(env.redisUrl);
      telegramDeps = {
        ...telegramDeps,
        dedupStore: new RedisDedupStore(redis),
      };
    } else {
      telegramDeps = {
        ...telegramDeps,
        dedupStore: new InMemoryDedupStore(),
      };
    }
  }

  const telegramWebhookHandler = dependencies?.telegramWebhookHandler
    ?? await createTelegramWebhookHandler(env, telegramDeps);

  app.use(correlationIdMiddleware());
  app.use(requestLoggingMiddleware());

  app.get("/health", async (_request: ExpressRequest, response: ExpressResponse) => {
    const healthResponse = handleHealthRequest();
    response.status(healthResponse.status);
    for (const [key, value] of healthResponse.headers.entries()) {
      response.setHeader(key, value);
    }
    response.send(await healthResponse.text());
  });

  app.use("/webhook/telegram", express.text({ type: "*/*" }));

  app.post("/webhook/telegram", async (request: ExpressRequest, response: ExpressResponse, next) => {
    try {
      const fetchRequest = new Request(`http://localhost${request.path}`, {
        method: request.method,
        headers: toHeaderEntries(request, response),
        body: typeof request.body === "string" ? request.body : "",
      });

      const webhookResponse = await telegramWebhookHandler.handle(fetchRequest);
      response.status(webhookResponse.status);
      for (const [key, value] of webhookResponse.headers.entries()) {
        response.setHeader(key, value);
      }
      response.send(await webhookResponse.text());
    } catch (error) {
      next(error);
    }
  });

  app.use((_request: ExpressRequest, response: ExpressResponse) => {
    response.status(404).type("text/plain").send("Not Found");
  });

  app.use(errorHandlerMiddleware());

  return app;
};
