import { chmod, rm, stat } from "node:fs/promises";
import type { Server } from "bun";

export class EngineRunningError extends Error {
  constructor(readonly socketPath: string) {
    super(`another wa engine is already running on ${socketPath}`);
  }
}

/**
 * Listens on the admin socket (0600). A socket file left by a crashed engine is replaced; one
 * that still answers means another engine owns this WA_HOME.
 */
export async function listenOnSocket(
  path: string,
  fetch: (request: Request, server: Server<undefined>) => Response | Promise<Response>,
): Promise<Server<undefined>> {
  if (await stat(path).catch(() => null)) {
    const alive = await globalThis
      .fetch("http://localhost/v1/health", { unix: path })
      .then(() => true)
      .catch(() => false);
    if (alive) throw new EngineRunningError(path);
    await rm(path, { force: true });
  }
  const server = Bun.serve({ unix: path, fetch });
  await chmod(path, 0o600);
  return server;
}
