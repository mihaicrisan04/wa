import { chmod, mkdir, rm } from "node:fs/promises";
import { MAX_UPLOAD_BYTES } from "@wa/sdk";
import type { Server } from "bun";
import { ensureRaycastAccess } from "./access";
import { createApp, type ApiDeps, type App } from "./api/app";
import { claimSocket, listenOnSocket } from "./api/socket";
import {
  databasePath,
  ENGINE_VERSION,
  restrictFileModes,
  socketPath,
  type EngineConfig,
} from "./config";
import { Ingest } from "./ingest";
import { createLogger, type Logger } from "./logger";
import { Outbox } from "./outbox";
import { openStore, type Store } from "./store";
import type { ClientFactory, SocketHooks, WhatsAppClient } from "./whatsapp/client";
import { WhatsAppConnection } from "./whatsapp/connection";
import { MediaCache, removeCachedFiles, type MediaCacheOptions } from "./whatsapp/media";
import { baileysClientFactory } from "./whatsapp/socket";

export interface StartEngineOptions {
  /** A client (or factory) replacing the real Baileys socket, e.g. the fake client in tests. */
  client?: WhatsAppClient | ClientFactory;
  logger?: Logger;
  reconnectBackoff?: { baseMs: number; maxMs: number };
  outboxBackoff?: { baseMs: number; maxMs: number };
  /** How often disappearing messages past their expiry are purged. */
  purgeIntervalMs?: number;
  /** Where MCP `download_media` exports files; `$TMPDIR/wa-export` by default. */
  exportDir?: string;
  /** Replaces Baileys' media downloader (tests must never reach WhatsApp's CDN). */
  mediaDownload?: MediaCacheOptions["download"];
}

export interface Engine {
  /** The bound port; differs from the config when it asked for port 0. */
  port: number;
  /** The admin unix socket. */
  socketPath: string;
  connection: WhatsAppConnection;
  store: Store;
  ingest: Ingest;
  media: MediaCache;
  outbox: Outbox;
  /** The HTTP apps behind the TCP listener and the admin socket. */
  apps: { tcp: App; admin: App };
  stop(): Promise<void>;
}

const PURGE_INTERVAL_MS = 60_000;
// Bun's 128 MB default would cut file uploads off mid-stream; leave room for the multipart fields
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

export async function startEngine(
  config: EngineConfig,
  options: StartEngineOptions = {},
): Promise<Engine> {
  restrictFileModes();
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  await chmod(config.home, 0o700);
  const adminSocket = socketPath(config.home);
  await claimSocket(adminSocket);

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
    download: options.mediaDownload,
  });
  const outbox = new Outbox({
    store,
    home: config.home,
    logger,
    client: () => (connection.status().state === "open" ? connection.client() : null),
    me: () => connection.me(),
    backoff: options.outboxBackoff,
  });
  connection.onOpen(() => outbox.flush());

  const purge = setInterval(() => {
    void removeCachedFiles(store.purgeExpired(), logger).catch((err: unknown) => {
      logger.error({ err }, "could not purge disappearing messages");
    });
    void outbox.expire();
  }, options.purgeIntervalMs ?? PURGE_INTERVAL_MS);

  let server: Server<undefined> | null = null;
  let adminServer: Server<undefined> | null = null;
  const deps: ApiDeps = {
    version: ENGINE_VERSION,
    logger,
    store,
    connection,
    media,
    outbox,
    exportDir: options.exportDir,
  };
  const apps = {
    tcp: createApp(
      { ...deps, noTimeout: (request) => server?.timeout(request, 0) },
      { kind: "tcp", port: () => server?.port ?? config.port },
    ),
    admin: createApp(
      { ...deps, noTimeout: (request) => adminServer?.timeout(request, 0) },
      { kind: "unix" },
    ),
  };

  const stop = async () => {
    clearInterval(purge);
    await connection.stop();
    await outbox.stop();
    await server?.stop(true);
    if (adminServer) {
      await adminServer.stop(true);
      await rm(adminSocket, { force: true });
    }
    await ingest.drain();
    store.close();
  };

  try {
    await ensureRaycastAccess(store, config.home);
    adminServer = await listenOnSocket(adminSocket, apps.admin.fetch);
    server = Bun.serve({
      hostname: config.host,
      port: config.port,
      fetch: apps.tcp.fetch,
      maxRequestBodySize: MAX_REQUEST_BYTES,
    });
    logger.info({ port: server.port }, "wa engine listening");
    await connection.start();
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    port: server.port ?? config.port,
    socketPath: adminSocket,
    connection,
    store,
    ingest,
    media,
    outbox,
    apps,
    stop,
  };
}

function toFactory(client: StartEngineOptions["client"]): ClientFactory | undefined {
  if (!client || typeof client === "function") return client;
  return () => client;
}
