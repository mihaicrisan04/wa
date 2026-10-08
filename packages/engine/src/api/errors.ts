import type { ApiErrorBody } from "@wa/sdk";
import type { Context } from "hono";
import { notFound, toClientError, type ApiError } from "../errors";
import type { Logger } from "../logger";

function errorBody({ code, message, candidates }: ApiError): ApiErrorBody {
  return { error: { code, message, ...(candidates ? { candidates } : {}) } };
}

export function notFoundHandler(c: Context) {
  return c.json(errorBody(notFound()), 404);
}

/** Internal errors never leak driver or library message text to clients. */
export function errorHandler(logger: Logger) {
  return (err: Error, c: Context) => {
    const clientError = toClientError(err);
    if (clientError) return c.json(errorBody(clientError), clientError.status);
    logger.error({ err, path: c.req.path }, "request failed");
    return c.json(
      { error: { code: "internal", message: "internal error" } } satisfies ApiErrorBody,
      500,
    );
  };
}
