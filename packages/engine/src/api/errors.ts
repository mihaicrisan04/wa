import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import type { Logger } from "../logger";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function notFound(c: Context) {
  return c.json(errorBody("not_found", "not found"), 404);
}

/** Internal errors never leak driver or library message text to clients. */
export function errorHandler(logger: Logger) {
  return (err: Error, c: Context) => {
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
    if (err instanceof ZodError) {
      const message = err.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; ");
      return c.json(errorBody("invalid_request", message), 400);
    }
    logger.error({ err, path: c.req.path }, "request failed");
    return c.json(errorBody("internal", "internal error"), 500);
  };
}
