import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

export const CORRELATION_ID_HEADER = "x-correlation-id";

const getCorrelationIdFromHeader = (value: string | string[] | undefined): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    const firstValue = value[0];
    if (typeof firstValue === "string" && firstValue.trim().length > 0) {
      return firstValue;
    }
  }

  return undefined;
};

export const correlationIdMiddleware = (): RequestHandler => {
  return (request, response, next) => {
    const correlationId = getCorrelationIdFromHeader(request.headers[CORRELATION_ID_HEADER]) ?? randomUUID();
    response.locals.correlationId = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  };
};
