import { rename } from "node:fs/promises";
import { join } from "node:path";
import {
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState,
  type AuthenticationState,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import type { Logger } from "../logger";
import type { ClientEvents, ClientFactory, WhatsAppClient } from "./client";

export type ConnectionState =
  /** No credentials yet; idle until `link()`. */
  | "not_linked"
  /** Socket open for pairing, QR codes are being issued. */
  | "linking"
  | "connecting"
  | "open"
  | "reconnecting"
  /** Logged out from the phone; credentials were moved aside. */
  | "needs_link"
  /** Another session took over; never reconnects on its own. */
  | "replaced"
  | "stopped";

export interface OwnIdentity {
  pn: string;
  lid: string | null;
}

export interface ConnectionStatus {
  state: ConnectionState;
  qr: string | null;
  me: OwnIdentity | null;
  lastDisconnect: { code: number | null; at: number } | null;
}

export interface ConnectionOptions {
  home: string;
  logger: Logger;
  createClient: ClientFactory;
  backoff?: { baseMs: number; maxMs: number };
}

type ClientListener = (client: WhatsAppClient) => void | Promise<void>;

const DEFAULT_BACKOFF = { baseMs: 1_000, maxMs: 60_000 };

export class AlreadyLinkedError extends Error {
  constructor() {
    super("WhatsApp is already linked");
  }
}

export class WhatsAppConnection {
  private auth: { state: AuthenticationState; saveCreds: () => Promise<void> } | null = null;
  private socket: WhatsAppClient | null = null;
  private detachSocket: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private generation = 0;
  private state: ConnectionState = "stopped";
  private qr: string | null = null;
  private lastDisconnect: ConnectionStatus["lastDisconnect"] = null;
  private readonly clientListeners = new Set<ClientListener>();
  private readonly openListeners = new Set<ClientListener>();
  private readonly backoff: { baseMs: number; maxMs: number };

  constructor(private readonly options: ConnectionOptions) {
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
  }

  private get logger(): Logger {
    return this.options.logger;
  }

  private get authDir(): string {
    return join(this.options.home, "auth");
  }

  async start(): Promise<void> {
    await this.loadAuth();
    if (this.isLinked()) await this.connect("connecting");
    else this.state = "not_linked";
  }

  async stop(): Promise<void> {
    this.state = "stopped";
    this.clearReconnectTimer();
    await this.retireSocket();
  }

  /** Opens a pairing socket. Refuses when already linked unless `relink` is set. */
  async link({ relink = false }: { relink?: boolean } = {}): Promise<void> {
    if (this.isLinked()) {
      if (!relink) throw new AlreadyLinkedError();
      await this.retireSocket();
      await this.moveAuthAside("relinked");
    }
    if (this.state === "linking" && this.socket) return;
    await this.connect("linking");
  }

  status(): ConnectionStatus {
    return { state: this.state, qr: this.qr, me: this.me(), lastDisconnect: this.lastDisconnect };
  }

  /** Read from the persisted credentials, so it is known while disconnected too. */
  me(): OwnIdentity | null {
    const me = this.auth?.state.creds.me;
    if (!me?.id) return null;
    return { pn: jidNormalizedUser(me.id), lid: me.lid ? jidNormalizedUser(me.lid) : null };
  }

  isLinked(): boolean {
    return Boolean(this.auth?.state.creds.me?.id);
  }

  client(): WhatsAppClient | null {
    return this.socket;
  }

  /** Runs for every new socket, before any of its events are processed. */
  onClient(listener: ClientListener): () => void {
    this.clientListeners.add(listener);
    return () => this.clientListeners.delete(listener);
  }

  onOpen(listener: ClientListener): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  private async loadAuth(): Promise<void> {
    this.auth = await useMultiFileAuthState(this.authDir);
  }

  private async connect(state: "linking" | "connecting"): Promise<void> {
    this.clearReconnectTimer();
    await this.retireSocket();
    this.state = state;
    const generation = this.generation;
    const auth = this.auth;
    if (!auth) throw new Error("connection.start() must run before connecting");

    let client: WhatsAppClient;
    try {
      client = await this.options.createClient(auth.state);
    } catch (err) {
      this.logger.error({ err }, "could not create the WhatsApp socket");
      this.scheduleReconnect();
      return;
    }
    if (generation !== this.generation) {
      await endClient(client);
      return;
    }

    this.socket = client;
    this.detachSocket = client.ev.process((events) => this.handleEvents(client, events));
    for (const listener of this.clientListeners) await listener(client);
  }

  private async handleEvents(
    client: WhatsAppClient,
    events: Partial<BaileysEventMap>,
  ): Promise<void> {
    if (client !== this.socket) return;
    try {
      const creds = events["creds.update"];
      if (creds && this.auth) {
        Object.assign(this.auth.state.creds, creds);
        await this.auth.saveCreds();
      }
      const update = events["connection.update"];
      if (update?.qr) this.qr = update.qr;
      if (update?.connection === "open") await this.handleOpen(client);
      if (update?.connection === "close")
        await this.handleClose(disconnectCode(update.lastDisconnect?.error));
    } catch (err) {
      this.logger.error({ err }, "connection event handling failed");
    }
  }

  private async handleOpen(client: WhatsAppClient): Promise<void> {
    this.state = "open";
    this.qr = null;
    this.reconnectAttempt = 0;
    this.logger.info({ me: this.me()?.pn }, "WhatsApp connected");

    // emits groups.update with full metadata; ingest stores it from there
    await client.groupFetchAllParticipating().catch((err: unknown) => {
      this.logger.warn({ err }, "could not fetch groups");
    });
    for (const listener of this.openListeners) {
      try {
        await listener(client);
      } catch (err) {
        this.logger.error({ err }, "on-open listener failed");
      }
    }
  }

  private async handleClose(code: number | null): Promise<void> {
    this.lastDisconnect = { code, at: Date.now() };
    await this.retireSocket();
    if (this.state === "stopped") return;

    if (code === DisconnectReason.restartRequired) {
      await this.connect(this.isLinked() ? "connecting" : "linking");
    } else if (code === DisconnectReason.loggedOut) {
      this.logger.warn("logged out from the phone, WhatsApp needs to be linked again");
      await this.moveAuthAside("logged-out");
      this.state = "needs_link";
    } else if (code === DisconnectReason.connectionReplaced) {
      this.logger.error("another session replaced this connection, not reconnecting");
      this.state = "replaced";
    } else if (!this.isLinked()) {
      this.state = "not_linked";
    } else {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const delay = Math.min(
      this.backoff.baseMs * 2 ** (this.reconnectAttempt - 1),
      this.backoff.maxMs,
    );
    this.state = "reconnecting";
    this.logger.info({ delay, attempt: this.reconnectAttempt }, "reconnecting to WhatsApp");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect("connecting");
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async retireSocket(): Promise<void> {
    this.generation++;
    const client = this.socket;
    this.socket = null;
    this.qr = null;
    this.detachSocket?.();
    this.detachSocket = null;
    if (client) await endClient(client);
  }

  private async moveAuthAside(reason: string): Promise<void> {
    const stamp = new Date().toISOString().replaceAll(":", "-");
    await rename(this.authDir, `${this.authDir}-${reason}-${stamp}`).catch((err: unknown) => {
      this.logger.warn({ err }, "could not move the old credentials aside");
    });
    await this.loadAuth();
  }
}

async function endClient(client: WhatsAppClient): Promise<void> {
  await client.end(undefined).catch(() => undefined);
  removeAllListeners(client.ev);
}

function removeAllListeners(ev: ClientEvents): void {
  // Baileys types require an event name, but the emitter clears everything without one
  (ev.removeAllListeners as () => void)();
}

function disconnectCode(error: unknown): number | null {
  const code = (error as { output?: { statusCode?: unknown } } | undefined)?.output?.statusCode;
  return typeof code === "number" ? code : null;
}
