import { loadConfig, socketPath } from "@wa/engine";
import { createWaClient, START_ENGINE, type WaClient } from "@wa/sdk";
import { errorCode } from "./exec";

export class EngineUnavailableError extends Error {
  constructor(readonly socket: string) {
    super(
      `the wa engine is not running: start it with ${START_ENGINE}; \`wa service status\` shows why a service stopped`,
    );
  }
}

/** The engine's admin API over `WA_HOME/engine.sock`: no token, full access. */
export function engineClient(env: Record<string, string | undefined>): WaClient {
  const socket = socketPath(loadConfig(env).home);
  return createWaClient({
    baseUrl: "http://localhost",
    timeoutMs: 30_000,
    fetch: async (input, init) => {
      try {
        return await fetch(input, { ...init, unix: socket });
      } catch (err) {
        if (isConnectionError(err)) throw new EngineUnavailableError(socket);
        throw err;
      }
    },
  });
}

const CONNECTION_ERRORS = new Set([
  "FailedToOpenSocket",
  "ConnectionRefused",
  "ENOENT",
  "ECONNREFUSED",
]);

function isConnectionError(err: unknown): boolean {
  return CONNECTION_ERRORS.has(errorCode(err) ?? "");
}
