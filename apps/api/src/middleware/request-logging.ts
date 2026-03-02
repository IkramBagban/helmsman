import type { RequestHandler } from "express";

import { createFileLogger } from "@helmsman/shared";

const logger = createFileLogger({ component: "api" });

const SENSITIVE_KEY_PATTERN = /(token|secret|password|private.?key|api.?key|authorization|credential|cookie)/i;
const MAX_BODY_LENGTH = 1200;

const truncate = (value: string): string => {
  if (value.length <= MAX_BODY_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_BODY_LENGTH)}(truncated)`;
};

const sanitize = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitize(entry));
  }

  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitized[key] = "[redacted]";
        continue;
      }
      sanitized[key] = sanitize(entry);
    }
    return sanitized;
  }

  return String(value);
};

export const requestLoggingMiddleware = (): RequestHandler => {
  return (request, response, next) => {
    const startedAt = process.hrtime.bigint();
    let responseBody: unknown;

    const originalSend = response.send.bind(response);
    response.send = ((body: unknown) => {
      responseBody = body;
      return originalSend(body as never);
    }) as typeof response.send;

    logger.log("info", "request.received", {
      correlationId: response.locals.correlationId as string | undefined,
      method: request.method,
      route: request.originalUrl || request.path,
      query: sanitize(request.query),
      headers: sanitize(request.headers),
      body: sanitize(request.body),
    });

    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const correlationId = response.locals.correlationId as string | undefined;
      const route = request.originalUrl || request.path;

      logger.log("info", "response.sent", {
        correlationId,
        method: request.method,
        route,
        status: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        body: sanitize(responseBody),
      });
    });

    next();
  };
};
