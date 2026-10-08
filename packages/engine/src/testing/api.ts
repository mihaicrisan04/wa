import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { BaileysEventMap, WAMessage } from "@whiskeysockets/baileys";
import type { ProfileCapability } from "@wa/sdk";
import { raycastTokenPath } from "../config";
import { startEngine, type Engine, type StartEngineOptions } from "../engine";
import { issueToken } from "../tokens";
import type { SocketHooks } from "../whatsapp/client";
import type { MediaCacheOptions } from "../whatsapp/media";
import { FakeWhatsAppClient } from "./fake-client";
import { ME } from "./jids";
import { silentLogger } from "./logger";
import { makeTempHome, type TempHome } from "./temp-home";

export interface ApiHarness {
  temp: TempHome;
  /** Where MCP `download_media` exports to; outside `temp.home`, removed by `stop()`. */
  exportDir: string;
  /** Changes on `restart()`. */
  engine: Engine;
  /** The current fake socket (a new one per connect). */
  client(): FakeWhatsAppClient;
  /** Calls the TCP listener; `token` goes in the Authorization header. */
  http(path: string, token: string | null, init?: RequestInit): Promise<Response>;
  /** Calls the admin unix socket. */
  admin(path: string, init?: RequestInit): Promise<Response>;
  emit(events: Partial<BaileysEventMap>): Promise<void>;
  /** A profile (and its collections, with their chats) with a fresh token for it. */
  token(profile: ProfileSpecInput): string;
  /** The built-in raycast profile's token, from its file. */
  raycastToken(): Promise<string>;
  /** Stops the engine and starts a new one on the same WA_HOME, still linked. */
  restart(): Promise<Engine>;
  stop(): Promise<void>;
}

export interface ProfileSpecInput {
  name: string;
  capabilities: ProfileCapability[];
  /** Collection name → the chats in it; created when missing. */
  collections?: Record<string, string[]>;
  allChats?: boolean;
}

export interface StartApiOptions {
  /** Pair with WhatsApp first (default true). */
  linked?: boolean;
  /** Leave the connection open after pairing (default true). */
  open?: boolean;
  /** Called with the Baileys hooks every socket gets. */
  onHooks?: (hooks: SocketHooks) => void;
  engine?: StartEngineOptions;
}

/** An engine on a temp WA_HOME and an ephemeral port, driven through a fake socket. */
export async function startApi(options: StartApiOptions = {}): Promise<ApiHarness> {
  const temp = await makeTempHome();
  const exportDir = await mkdtemp(join(tmpdir(), "wa export "));
  let client = new FakeWhatsAppClient();
  const engineOptions: StartEngineOptions = {
    client: (_auth, hooks) => {
      options.onHooks?.(hooks);
      client = new FakeWhatsAppClient(client.user);
      return client;
    },
    logger: silentLogger,
    reconnectBackoff: { baseMs: 5, maxMs: 20 },
    outboxBackoff: { baseMs: 5, maxMs: 20 },
    exportDir,
    ...options.engine,
  };
  const engine = await startEngine(temp.config, engineOptions);
  if (options.linked ?? true) {
    await engine.connection.link();
    client.pair(ME);
    await client.idle();
    if (options.open ?? true) {
      client.open();
      await client.idle();
    }
  }

  const harness: ApiHarness = {
    temp,
    exportDir,
    engine,
    client: () => client,
    http(path, token, init = {}) {
      const headers = new Headers(init.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      return fetch(`http://127.0.0.1:${harness.engine.port}${path}`, { ...init, headers });
    },
    admin(path, init = {}) {
      return fetch(`http://localhost${path}`, { ...init, unix: harness.engine.socketPath });
    },
    async emit(events) {
      client.emitBatch(events);
      await client.idle();
      await harness.engine.ingest.drain();
    },
    token(spec) {
      const { store } = harness.engine;
      const collections = Object.entries(spec.collections ?? {});
      for (const [name, chats] of collections) {
        store.collections.create(name, null);
        for (const chat of chats) store.collections.addChat(name, chat);
      }
      store.profiles.create({
        name: spec.name,
        capabilities: spec.capabilities,
        allChats: spec.allChats ?? false,
        collections: collections.map(([name]) => name),
      });
      return issueToken(store, spec.name, null).token;
    },
    async raycastToken() {
      return (await readFile(raycastTokenPath(temp.home), "utf8")).trim();
    },
    async restart() {
      await harness.engine.stop();
      harness.engine = await startEngine(temp.config, engineOptions);
      return harness.engine;
    },
    async stop() {
      await harness.engine.stop();
      await temp.cleanup();
      await rm(exportDir, { recursive: true, force: true });
    },
  };
  return harness;
}

export function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** A bare JSON-RPC `tools/list` call on `/mcp`, for checks below the MCP client. */
export const mcpToolsListRequest = {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
} satisfies RequestInit;

/** Stands in for Baileys' media download, so tests never reach WhatsApp's CDN. */
export function fakeMediaDownload(
  bytes: Uint8Array | ((message: WAMessage) => Uint8Array),
): NonNullable<MediaCacheOptions["download"]> {
  const download = async (message: WAMessage) =>
    Readable.from([typeof bytes === "function" ? bytes(message) : bytes]);
  // Baileys' downloader is overloaded per output type; the engine only asks for a stream
  return download as unknown as NonNullable<MediaCacheOptions["download"]>;
}
