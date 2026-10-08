import { chmod, mkdir } from "node:fs/promises";
import { createApp } from "./api/app";
import { databasePath, ENGINE_VERSION, restrictFileModes, type EngineConfig } from "./config";
import { Ingest } from "./ingest";
import { createLogger, type Logger } from "./logger";
import { openStore, type Store } from "./store";
import type { ClientFactory, SocketHooks, WhatsAppClient } from "./whatsapp/client";
import { WhatsAppConnection } from "./whatsapp/connection";
import { MediaCache, removeCachedFiles } from "./whatsapp/media";
import { baileysClientFactory } from "./whatsapp/socket";

export interface StartEngineOptions {
  /** A client (or factory) replacing the real Baileys socket, e.g. the fake client in tests. */
  client?: WhatsAppClient | ClientFactory;
  logger?: Logger;
  reconnectBackoff?: { baseMs: number; maxMs: number };
  /** How often disappearing messages past their expiry are purged. */
  purgeIntervalMs?: number;
}

export interface Engine {
  /** The bound port; differs from the config when it asked for port 0. */
  port: number;
  connection: WhatsAppConnection;
  store: Store;
  ingest: Ingest;
  media: MediaCache;
  stop(): Promise<void>;
}

const PURGE_INTERVAL_MS = 60_000;

export async function startEngine(
  config: EngineConfig,
  options: StartEngineOptions = {},
): Promise<Engine> {
  restrictFileModes();
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  await chmod(config.home, 0o700);

  const logger = options.logger ?? createLogger(config.logLevel);
  const store = openStore(databasePath(config.home));
  const ingest: Ingest = new Ingest({ store, logger, me: () => connection.me() });
  const hooks: SocketHooks = {
    getMessage: async (key) => ingest.messageContent(key),
    cachedGroupMetadata: async (jid) => ingest.groups.get(jid),
  };
  const createClient = toFactory(options.client) ?? baileysClientFactory(logger);
  const connection: WhatsAppConnection = new WhatsAppConnection({
    home: config.home,
    logger,
    createClient: (auth) => createClient(auth, hooks),
    backoff: options.reconnectBackoff,
  });
  connection.onClient((client) => ingest.attach(client));
  const media = new MediaCache({
    store,
    home: config.home,
    logger,
    client: () => connection.client(),
  });

  const purge = setInterval(() => {
    void removeCachedFiles(store.purgeExpired(), logger).catch((err: unknown) => {
      logger.error({ err }, "could not purge disappearing messages");
    });
  }, options.purgeIntervalMs ?? PURGE_INTERVAL_MS);

  const app = createApp({
    version: ENGINE_VERSION,
    logger,
    port: () => server.port ?? config.port,
  });
  const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch });
  logger.info({ port: server.port }, "wa engine listening");

  const stop = async () => {
    clearInterval(purge);
    await connection.stop();
    await server.stop(true);
    await ingest.drain();
    store.close();
  };

  try {
    await connection.start();
  } catch (err) {
    await stop();
    throw err;
  }

  return { port: server.port ?? config.port, connection, store, ingest, media, stop };
}

function toFactory(client: StartEngineOptions["client"]): ClientFactory | undefined {
  if (!client || typeof client === "function") return client;
  return () => client;
}
