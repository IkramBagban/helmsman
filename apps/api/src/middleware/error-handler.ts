import type { ErrorRequestHandler } from "express";

import { AppError } from "@helmsman/shared";
import { createFileLogger } from "@helmsman/shared/file-logger";

const logger = createFileLogger({ component: "api" });

export const errorHandlerMiddleware = (): ErrorRequestHandler => {
  return (error, request, response, _next) => {
    const correlationId = response.locals.correlationId as string | undefined;
    const safeError = error instanceof AppError
      ? error
      : new AppError("INTERNAL_SERVER_ERROR", "Unexpected server error", { error });

    logger.log("error", "request.failed", {
      correlationId,
      route: request.originalUrl || request.path,
      method: request.method,
      code: safeError.code,
      message: safeError.message,
      context: safeError.context,
    });

    if (response.headersSent) {
      return;
    }

    if (request.path === "/webhook/telegram") {
      response.status(200).json({ ok: true });
      return;
    }

    response.status(500).json({
      error: {
        code: safeError.code,
        message: safeError.message,
        correlationId,
      },
    });
  };
};
