import { chmod, mkdir } from "node:fs/promises";
import { createApp } from "./api/app";
import { ENGINE_VERSION, restrictFileModes, type EngineConfig } from "./config";
import { createLogger, type Logger } from "./logger";
import type { ClientFactory, WhatsAppClient } from "./whatsapp/client";
import { WhatsAppConnection } from "./whatsapp/connection";
import { baileysClientFactory } from "./whatsapp/socket";

export interface StartEngineOptions {
  /** A client (or factory) replacing the real Baileys socket, e.g. the fake client in tests. */
  client?: WhatsAppClient | ClientFactory;
  logger?: Logger;
  reconnectBackoff?: { baseMs: number; maxMs: number };
}

export interface Engine {
  /** The bound port; differs from the config when it asked for port 0. */
  port: number;
  connection: WhatsAppConnection;
  stop(): Promise<void>;
}

export async function startEngine(
  config: EngineConfig,
  options: StartEngineOptions = {},
): Promise<Engine> {
  restrictFileModes();
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  await chmod(config.home, 0o700);

  const logger = options.logger ?? createLogger(config.logLevel);
  const connection = new WhatsAppConnection({
    home: config.home,
    logger,
    createClient: toFactory(options.client) ?? baileysClientFactory(logger),
    backoff: options.reconnectBackoff,
  });

  const app = createApp({
    version: ENGINE_VERSION,
    logger,
    port: () => server.port ?? config.port,
  });
  const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch });
  logger.info({ port: server.port }, "wa engine listening");

  try {
    await connection.start();
  } catch (err) {
    await server.stop(true);
    throw err;
  }

  return {
    port: server.port ?? config.port,
    connection,
    async stop() {
      await connection.stop();
      await server.stop(true);
    },
  };
}

function toFactory(client: StartEngineOptions["client"]): ClientFactory | undefined {
  if (!client || typeof client === "function") return client;
  return () => client;
}
