import type { ErrorRequestHandler } from "express";

import { AppError } from "@helmsman/shared";

export const errorHandlerMiddleware = (): ErrorRequestHandler => {
  return (error, request, response, _next) => {
    const correlationId = response.locals.correlationId as string | undefined;
    const safeError = error instanceof AppError
      ? error
      : new AppError("INTERNAL_SERVER_ERROR", "Unexpected server error", { error });

    console.error("Request failed", {
      correlationId,
      route: request.originalUrl || request.path,
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
