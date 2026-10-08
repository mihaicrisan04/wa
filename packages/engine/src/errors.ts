import type { ChatCandidate } from "@wa/sdk";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 503;

/** An error whose code and message are safe to show to the client that caused it. */
export class ApiError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: string,
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

export function ambiguous(input: string, candidates: ChatCandidate[]): ApiError {
  return new ApiError(409, "ambiguous", `"${input}" matches more than one chat`, candidates);
}

export function notLinked(): ApiError {
  return new ApiError(409, "not_linked", "WhatsApp is not linked yet");
}
