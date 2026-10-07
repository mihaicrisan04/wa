import type { ApiErrorBody } from "@wa/sdk";
import type { Context } from "hono";
import { ZodError } from "zod";
import { ApiError } from "../errors";
import type { Logger } from "../logger";

export { ApiError };

export function errorBody(
  code: string,
  message: string,
  candidates?: ApiErrorBody["error"]["candidates"],
): ApiErrorBody {
  return { error: { code, message, ...(candidates ? { candidates } : {}) } };
}

export function notFound(c: Context) {
  return c.json(errorBody("not_found", "not found"), 404);
}

/** Internal errors never leak driver or library message text to clients. */
export function errorHandler(logger: Logger) {
  return (err: Error, c: Context) => {
    if (err instanceof ApiError) {
      return c.json(errorBody(err.code, err.message, err.candidates), err.status);
    }
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
