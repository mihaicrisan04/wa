import { chmod, rm, stat } from "node:fs/promises";
import type { Server } from "bun";

export class EngineRunningError extends Error {
  constructor(readonly socketPath: string) {
    super(`another wa engine is already running on ${socketPath}`);
  }
}

/**
 * Run before touching anything in WA_HOME: a socket that still answers means another engine
 * owns it; one left by a crashed engine is removed.
 */
export async function claimSocket(path: string): Promise<void> {
  if (!(await stat(path).catch(() => null))) return;
  const alive = await fetch("http://localhost/v1/health", { unix: path })
    .then(() => true)
    .catch(() => false);
  if (alive) throw new EngineRunningError(path);
  await rm(path, { force: true });
}

/** The admin listener; only the owning user may connect (0600). */
export async function listenOnSocket(
  path: string,
  fetch: (request: Request, server: Server<undefined>) => Response | Promise<Response>,
): Promise<Server<undefined>> {
  const server = Bun.serve({ unix: path, fetch });
  await chmod(path, 0o600);
  return server;
}
