import type { BaileysEventMap } from "@whiskeysockets/baileys";
import type { ProfileCapability } from "@wa/sdk";
import { issueToken } from "../../src/access";
import { startEngine, type Engine, type StartEngineOptions } from "../../src/engine";
import { FakeWhatsAppClient, makeTempHome, type TempHome } from "../../src/testing";
import { ME, silent } from "./harness";

export interface ApiHarness {
  temp: TempHome;
  engine: Engine;
  /** The current fake socket (a new one per connect). */
  client(): FakeWhatsAppClient;
  /** Calls the TCP listener; `token` goes in the Authorization header. */
  http(path: string, token: string | null, init?: RequestInit): Promise<Response>;
  /** Calls the admin unix socket. */
  admin(path: string, init?: RequestInit): Promise<Response>;
  emit(events: Partial<BaileysEventMap>): Promise<void>;
  /** A profile with a fresh token for it. */
  token(profile: ProfileSpecInput): string;
  stop(): Promise<void>;
}

export interface ProfileSpecInput {
  name: string;
  capabilities: ProfileCapability[];
  collections?: string[];
  allChats?: boolean;
}

export interface StartApiOptions {
  /** Pair with WhatsApp first (default true). */
  linked?: boolean;
  /** Leave the connection open after pairing (default true). */
  open?: boolean;
  engine?: StartEngineOptions;
}

export async function startApi(options: StartApiOptions = {}): Promise<ApiHarness> {
  const temp = await makeTempHome();
  let client = new FakeWhatsAppClient();
  const engine = await startEngine(temp.config, {
    client: () => {
      client = new FakeWhatsAppClient(client.user as never);
      return client;
    },
    logger: silent,
    reconnectBackoff: { baseMs: 5, maxMs: 20 },
    outboxBackoff: { baseMs: 5, maxMs: 20 },
    ...options.engine,
  });
  if (options.linked ?? true) {
    await engine.connection.link();
    client.pair(ME);
    await client.idle();
    if (options.open ?? true) {
      client.open();
      await client.idle();
    }
  }

  return {
    temp,
    engine,
    client: () => client,
    http(path, token, init = {}) {
      const headers = new Headers(init.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      return fetch(`http://127.0.0.1:${engine.port}${path}`, { ...init, headers });
    },
    admin(path, init = {}) {
      return fetch(`http://localhost${path}`, { ...init, unix: engine.socketPath });
    },
    async emit(events) {
      client.emitBatch(events);
      await client.idle();
      await engine.ingest.drain();
    },
    token(spec) {
      const { store } = engine;
      for (const collection of spec.collections ?? []) store.collections.create(collection, null);
      store.profiles.create({
        name: spec.name,
        capabilities: spec.capabilities,
        allChats: spec.allChats ?? false,
        collections: spec.collections ?? [],
      });
      return issueToken(store, spec.name, null).token;
    },
    async stop() {
      await engine.stop();
      await temp.cleanup();
    },
  };
}

export function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** Polls until `check` holds; fails the test after a second. */
export async function eventually(check: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 1_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}
