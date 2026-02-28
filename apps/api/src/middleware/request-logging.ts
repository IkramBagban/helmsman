import type { RequestHandler } from "express";

export const requestLoggingMiddleware = (): RequestHandler => {
  return (request, response, next) => {
    const startedAt = process.hrtime.bigint();

    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const correlationId = response.locals.correlationId as string | undefined;
      const route = request.originalUrl || request.path;

      console.info(JSON.stringify({
        correlationId,
        route,
        status: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      }));
    });

    next();
  };
};
