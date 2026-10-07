import type { ApiErrorCode, ChatCandidate } from "@wa/sdk";
import { ZodError } from "zod";
import { MediaUnavailableError } from "./whatsapp/media";

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 503;

/** An error whose code and message are safe to show to the client that caused it. */
export class ApiError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly candidates?: ChatCandidate[],
  ) {
    super(message);
  }
}

/** Also what an out-of-scope chat looks like: never a 403, so it can't be told apart. */
export function notFound(what = "not found"): ApiError {
  return new ApiError(404, "not_found", what);
}

export function invalid(message: string): ApiError {
  return new ApiError(400, "invalid_request", message);
}

export function forbidden(message: string): ApiError {
  return new ApiError(403, "forbidden", message);
}

export function conflict(code: ApiErrorCode, message: string): ApiError {
  return new ApiError(409, code, message);
}

export function ambiguous(input: string, candidates: ChatCandidate[]): ApiError {
  return new ApiError(409, "ambiguous", `"${input}" matches more than one chat`, candidates);
}

export function notLinked(): ApiError {
  return conflict("not_linked", "WhatsApp is not linked yet");
}

export function tooLarge(message: string): ApiError {
  return new ApiError(413, "too_large", message);
}

export function offline(message: string): ApiError {
  return new ApiError(503, "offline", message);
}

/** What the client may hear about `err`; null for internal errors, which stay generic. */
export function toClientError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) {
    return invalid(
      err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
    );
  }
  return null;
}

/** Why media can't be served, as the client may hear it; other errors pass through. */
export function mediaUnavailable(err: unknown): never {
  if (!(err instanceof MediaUnavailableError)) throw err;
  switch (err.reason) {
    case "not_found":
      throw notFound("media not found");
    case "not_media":
      throw new ApiError(404, "not_media", "this message has no media");
    case "view_once":
      throw new ApiError(404, "view_once", "view-once media is never downloaded");
    case "offline":
      throw offline("WhatsApp is not connected, media can't be downloaded now");
  }
}
