import { chmod, mkdir, rm } from "node:fs/promises";
import { MAX_UPLOAD_BYTES } from "@wa/sdk";
import type { Server } from "bun";
import { ensureRaycastAccess } from "./tokens";
import type { Backoff } from "./backoff";
import { Backfills } from "./backfill";
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
import { removeFiles } from "./fs";
import { MediaCache, type MediaCacheOptions } from "./whatsapp/media";
import { baileysClientFactory } from "./whatsapp/socket";

export interface StartEngineOptions {
  /** A client (or factory) replacing the real Baileys socket, e.g. the fake client in tests. */
  client?: WhatsAppClient | ClientFactory;
  logger?: Logger;
  reconnectBackoff?: Backoff;
  outboxBackoff?: Backoff;
  /** How often disappearing messages past their expiry are purged. */
  purgeIntervalMs?: number;
  /** Where MCP `download_media` exports files; `$TMPDIR/wa-export` by default. */
  exportDir?: string;
  /** Replaces Baileys' media downloader (tests must never reach WhatsApp's CDN). */
  mediaDownload?: MediaCacheOptions["download"];
  /** How long `wa backfill` waits for the phone to answer one page (45s). */
  backfillTimeoutMs?: number;
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
  backfills: Backfills;
  /** The HTTP apps behind the TCP listener and the admin socket. */
  apps: { tcp: App; admin: App };
  stop(): Promise<void>;
}

const PURGE_INTERVAL_MS = 60_000;
// Bun's 128 MB default would cut file uploads off mid-stream; leave room for the multipart fields
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

/** The long-lived parts of a running engine. */
type Services = Pick<Engine, "store" | "ingest" | "connection" | "media" | "outbox" | "backfills">;

/** Filled in once listening; the apps read them lazily. */
interface Listeners {
  tcp: Server<undefined> | null;
  admin: Server<undefined> | null;
}

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
  const services = createServices(config, options, logger);
  const stopPurging = purgeEvery(options.purgeIntervalMs ?? PURGE_INTERVAL_MS, services, logger);
  const listeners: Listeners = { tcp: null, admin: null };
  const apps = createApps(config, services, listeners, logger, options.exportDir);

  const stop = async () => {
    stopPurging();
    await services.backfills.stop();
    await services.connection.stop();
    await services.outbox.stop();
    await listeners.tcp?.stop(true);
    if (listeners.admin) {
      await listeners.admin.stop(true);
      await rm(adminSocket, { force: true });
    }
    await services.ingest.drain();
    services.store.close();
  };

  try {
    await ensureRaycastAccess(services.store, config.home);
    listeners.admin = await listenOnSocket(adminSocket, apps.admin.fetch);
    listeners.tcp = Bun.serve({
      hostname: config.host,
      port: config.port,
      fetch: apps.tcp.fetch,
      maxRequestBodySize: MAX_REQUEST_BYTES,
    });
    logger.info({ port: listeners.tcp.port }, "wa engine listening");
    await services.connection.start();
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    ...services,
    port: listeners.tcp.port ?? config.port,
    socketPath: adminSocket,
    apps,
    stop,
  };
}

function createServices(
  config: EngineConfig,
  options: StartEngineOptions,
  logger: Logger,
): Services {
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
  const connectedClient = () => (connection.status().state === "open" ? connection.client() : null);
  const outbox = new Outbox({
    store,
    home: config.home,
    logger,
    client: connectedClient,
    me: () => connection.me(),
    backoff: options.outboxBackoff,
  });
  connection.onOpen(() => outbox.flush());
  const backfills = new Backfills({
    store,
    ingest,
    logger,
    client: connectedClient,
    timeoutMs: options.backfillTimeoutMs,
  });
  return { store, ingest, connection, media, outbox, backfills };
}

function createApps(
  config: EngineConfig,
  services: Services,
  listeners: Listeners,
  logger: Logger,
  exportDir: string | undefined,
): Engine["apps"] {
  const deps: ApiDeps = { ...services, version: ENGINE_VERSION, logger, exportDir };
  return {
    tcp: createApp(
      { ...deps, noTimeout: (request) => listeners.tcp?.timeout(request, 0) },
      { kind: "tcp", port: () => listeners.tcp?.port ?? config.port },
    ),
    admin: createApp(
      { ...deps, noTimeout: (request) => listeners.admin?.timeout(request, 0) },
      { kind: "unix" },
    ),
  };
}

/** Purges expired disappearing messages and queued sends on a timer; returns how to stop it. */
function purgeEvery(intervalMs: number, { store, outbox }: Services, logger: Logger): () => void {
  const attempt = async (what: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (err) {
      logger.error({ err }, `could not purge ${what}`);
    }
  };
  const timer = setInterval(() => {
    void attempt("expired messages", () => removeFiles(store.purgeExpired(), logger));
    void attempt("expired sends", () => outbox.expire());
  }, intervalMs);
  return () => clearInterval(timer);
}

function toFactory(client: StartEngineOptions["client"]): ClientFactory | undefined {
  if (!client || typeof client === "function") return client;
  return () => client;
}
