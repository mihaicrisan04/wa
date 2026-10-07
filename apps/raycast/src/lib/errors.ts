import { WaApiError } from "@wa/sdk";
import { MissingTokenError } from "./settings";

export interface ErrorDescription {
  title: string;
  message: string;
}

const START_ENGINE = "Start it with `wa service install` (or `wa serve` in a terminal).";

/** What went wrong, phrased for a toast or an empty view. */
export function describeError(error: unknown, port: number): ErrorDescription {
  if (error instanceof MissingTokenError) {
    return {
      title: "No wa token",
      message: `The engine writes one when it starts. ${START_ENGINE} Or set the Token preference.`,
    };
  }
  if (error instanceof WaApiError) return describeApiError(error);
  if (isTimeout(error)) {
    return { title: "wa engine didn't answer", message: `127.0.0.1:${port} timed out.` };
  }
  if (isConnectionRefused(error)) {
    return {
      title: "wa engine isn't running",
      message: `Nothing answers on 127.0.0.1:${port}. ${START_ENGINE}`,
    };
  }
  if (isFetchFailure(error)) {
    return {
      title: "Lost the connection to the wa engine",
      message: `127.0.0.1:${port} hung up before answering, so an upload may have been cut off. Try again.`,
    };
  }
  return {
    title: "Something went wrong",
    message: error instanceof Error ? error.message : String(error),
  };
}

function describeApiError(error: WaApiError): ErrorDescription {
  switch (error.code) {
    case "unauthorized":
      return {
        title: "Token rejected",
        message:
          "Clear the Token preference to use the engine's raycast token, or paste a valid one.",
      };
    case "not_linked":
      return { title: "WhatsApp isn't linked", message: "Run Link WhatsApp first." };
    case "already_linked":
      return { title: "Already linked", message: error.message };
    case "not_found":
      return {
        title: "Not found",
        message: "It may have been deleted, or it's outside this token's chats.",
      };
    case "too_large":
      return { title: "File too large", message: "WhatsApp only takes files up to 2 GB." };
    case "view_once":
      return { title: "View-once media", message: "View-once media is never downloaded." };
    default:
      return { title: "wa engine error", message: error.message };
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Node's fetch rejects with `TypeError: fetch failed` and puts the socket error in `cause`. */
function isFetchFailure(error: unknown): error is Error {
  return error instanceof Error && error.message === "fetch failed";
}

function isConnectionRefused(error: unknown): boolean {
  return (
    isFetchFailure(error) &&
    (error.cause as { code?: unknown } | undefined)?.code === "ECONNREFUSED"
  );
}
