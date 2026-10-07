import {
  DisconnectReason,
  generateWAMessage,
  makeEventBuffer,
  proto,
  type AnyMessageContent,
  type BaileysEventMap,
  type Contact,
  type GroupMetadata,
  type LIDMapping,
  type MiscMessageGenerationOptions,
  type SignalRepositoryWithLIDStore,
  type WAMessage,
  type WAMessageKey,
} from "@whiskeysockets/baileys";
import pino from "pino";
import type { WhatsAppClient } from "../whatsapp/client";
import { fixtureId, historySet } from "./fixtures";

const silent = pino({ level: "silent" });

export interface FakeIdentity {
  /** Phone-number jid, e.g. `40700000001:3@s.whatsapp.net`. */
  id: string;
  lid?: string;
  name?: string;
}

export interface SentMessage {
  jid: string;
  content: AnyMessageContent;
  options: MiscMessageGenerationOptions | undefined;
  message: WAMessage;
}

export interface HistoryRequest {
  requestId: string;
  count: number;
  oldestKey: WAMessageKey;
  oldestTimestamp: number;
}

/** In-memory stand-in for Baileys' LID store; only the lookups the engine uses. */
export class FakeLidMapping {
  private readonly pnByLid = new Map<string, string>();

  async storeLIDPNMappings(pairs: LIDMapping[]): Promise<void> {
    for (const { lid, pn } of pairs) this.pnByLid.set(lid, pn);
  }

  async getPNForLID(lid: string): Promise<string | null> {
    return this.pnByLid.get(lid) ?? null;
  }

  async getPNsForLIDs(lids: string[]): Promise<LIDMapping[] | null> {
    const found = lids.flatMap((lid) => {
      const pn = this.pnByLid.get(lid);
      return pn ? [{ lid, pn }] : [];
    });
    return found.length ? found : null;
  }

  async getLIDForPN(pn: string): Promise<string | null> {
    for (const [lid, mapped] of this.pnByLid) if (mapped === pn) return lid;
    return null;
  }
}

/**
 * A `WhatsAppClient` that never touches the network. Events go through a real Baileys
 * event buffer, so `ev.process` batching behaves like production; outgoing messages are
 * built with Baileys' own `generateWAMessage` against a stub media upload.
 */
export class FakeWhatsAppClient implements WhatsAppClient {
  readonly ev: WhatsAppClient["ev"];
  readonly lidMapping = new FakeLidMapping();
  // the engine only uses lidMapping; the session crypto half is never exercised
  readonly signalRepository = {
    lidMapping: this.lidMapping,
  } as unknown as SignalRepositoryWithLIDStore;
  user: Contact | undefined;
  groups: Record<string, GroupMetadata> = {};
  ended = false;

  readonly sent: SentMessage[] = [];
  readonly historyRequests: HistoryRequest[] = [];
  readonly mediaReuploads: WAMessage[] = [];
  /** Throw from `sendMessage` while set, to simulate a flaky connection. */
  sendFailure: Error | null = null;
  /** What `updateMediaMessage` returns; defaults to the message with a fresh directPath. */
  reupload: (message: WAMessage) => WAMessage = (message) => ({
    ...message,
    message: refreshDirectPath(message.message),
  });

  private readonly pending = new Set<Promise<unknown>>();

  constructor(identity?: FakeIdentity) {
    if (identity) this.user = identity;
    const buffer = makeEventBuffer(silent);
    this.ev = {
      ...buffer,
      process: (handler) => buffer.process((events) => this.track(handler(events))),
    };
  }

  // --- test controls -----------------------------------------------------------------

  emit<T extends keyof BaileysEventMap>(event: T, data: BaileysEventMap[T]): void {
    this.ev.emit(event, data);
  }

  /** Emits several events as one buffered batch, the way Baileys does while syncing. */
  emitBatch(events: Partial<BaileysEventMap>): void {
    this.ev.buffer();
    for (const [event, data] of Object.entries(events)) {
      this.ev.emit(event as keyof BaileysEventMap, data as never);
    }
    this.ev.flush();
  }

  /** Simulates a successful (re)connect for an already linked account. */
  open(identity: FakeIdentity | undefined = this.user as FakeIdentity | undefined): void {
    if (identity) {
      this.user = identity;
      this.emit("creds.update", { me: identity });
    }
    this.emit("connection.update", { connection: "open" });
  }

  showQr(qr = "2@fixture-qr"): void {
    this.emit("connection.update", { qr });
  }

  /** Scanning the QR stores the new identity, then WhatsApp asks for a restart. */
  pair(identity: FakeIdentity): void {
    this.user = identity;
    this.emit("creds.update", { me: identity });
    this.close(DisconnectReason.restartRequired);
  }

  close(statusCode: number): void {
    const error = Object.assign(new Error(`connection closed (${statusCode})`), {
      output: { statusCode },
    });
    this.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error, date: new Date() },
    });
  }

  /** Answers a `fetchMessageHistory` request the way WhatsApp does: later, as an ON_DEMAND history set. */
  respondToHistory(requestId: string, messages: WAMessage[]): void {
    this.emit(
      "messaging-history.set",
      historySet({
        messages,
        syncType: proto.HistorySync.HistorySyncType.ON_DEMAND,
        isLatest: false,
        progress: null,
        peerDataRequestSessionId: requestId,
      }),
    );
  }

  /** Resolves once every `ev.process` handler triggered so far (and any they trigger) finished. */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled(this.pending);
  }

  // --- WhatsAppClient ----------------------------------------------------------------

  sendMessage = async (
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined> => {
    if (this.sendFailure) throw this.sendFailure;
    const message = await generateWAMessage(jid, content, {
      userJid: this.user?.id ?? "0@s.whatsapp.net",
      messageId: options?.messageId ?? fixtureId(),
      upload: async () => ({
        mediaUrl: "https://mmg.whatsapp.net/fixture",
        directPath: "/v/t62.fixture",
      }),
      logger: silent,
    });
    this.sent.push({ jid, content, options, message });
    this.emit("messages.upsert", { messages: [message], type: "append" });
    return message;
  };

  fetchMessageHistory = async (
    count: number,
    oldestKey: WAMessageKey,
    oldestTimestamp: number | { toNumber(): number },
  ): Promise<string> => {
    const requestId = fixtureId();
    const timestamp =
      typeof oldestTimestamp === "number" ? oldestTimestamp : oldestTimestamp.toNumber();
    this.historyRequests.push({ requestId, count, oldestKey, oldestTimestamp: timestamp });
    return requestId;
  };

  updateMediaMessage = async (message: WAMessage): Promise<WAMessage> => {
    this.mediaReuploads.push(message);
    return this.reupload(message);
  };

  groupFetchAllParticipating = async (): Promise<Record<string, GroupMetadata>> => {
    this.emit("groups.update", Object.values(this.groups));
    return this.groups;
  };

  end = async (error: Error | undefined): Promise<void> => {
    if (this.ended) return;
    this.ended = true;
    this.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error, date: new Date() },
    });
  };

  private track(work: void | Promise<void>): Promise<void> {
    const promise = Promise.resolve(work);
    const forget = () => this.pending.delete(promise);
    this.pending.add(promise);
    promise.then(forget, forget);
    return promise;
  }
}

function refreshDirectPath(
  message: proto.IMessage | null | undefined,
): proto.IMessage | null | undefined {
  if (!message) return message;
  const [type] = Object.keys(message) as (keyof proto.IMessage)[];
  if (!type) return message;
  return {
    ...message,
    [type]: { ...(message[type] as object), directPath: "/v/t62.fixture-refreshed" },
  };
}
