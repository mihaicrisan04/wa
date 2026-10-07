import { loadConfig, socketPath } from "@wa/engine";
import { createWaClient, type WaClient } from "@wa/sdk";

export class EngineUnavailableError extends Error {
  constructor(readonly socket: string) {
    super("the wa engine is not running (start it with `wa serve`)");
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

function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return (
    typeof code === "string" &&
    ["FailedToOpenSocket", "ConnectionRefused", "ENOENT", "ECONNREFUSED"].includes(code)
  );
}
