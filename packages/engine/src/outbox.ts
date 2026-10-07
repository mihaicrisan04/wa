import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateMessageIDV2 } from "@whiskeysockets/baileys";
import type { Logger } from "./logger";
import { nowSeconds, type OutboxPayload, type OutboxRow, type Store } from "./store";
import type { WhatsAppClient } from "./whatsapp/client";
import type { OwnIdentity } from "./whatsapp/connection";
import { removeCachedFiles } from "./whatsapp/media";
import { buildOutgoingContent, type OutgoingPayload } from "./whatsapp/outgoing";

export type OutgoingMessage =
  | { kind: "text"; text: string }
  | {
      kind: "file";
      bytes: Uint8Array;
      fileName: string;
      mimetype: string | null;
      caption: string | null;
    };

export interface OutboxOptions {
  store: Store;
  /** `WA_HOME`; uploaded files wait in `WA_HOME/outbox/<id>`. */
  home: string;
  logger: Logger;
  /** The socket when the connection is open, null otherwise. */
  client: () => WhatsAppClient | null;
  me: () => OwnIdentity | null;
  backoff?: { baseMs: number; maxMs: number };
  /** How long an entry may wait before it expires instead of going out late. */
  ttlSeconds?: number;
}

const DEFAULT_BACKOFF = { baseMs: 1_000, maxMs: 60_000 };
const DEFAULT_TTL_SECONDS = 60 * 60;

/**
 * The persisted send queue. Each entry gets its WhatsApp message id when queued and reuses it on
 * every attempt, so a retry after a crash can't send twice; entries go out one at a time, in order.
 */
export class Outbox {
  readonly dir: string;
  private running: Promise<void> | null = null;
  private flushAgain = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private stopped = false;

  constructor(private readonly options: OutboxOptions) {
    this.dir = join(options.home, "outbox");
    options.store.outbox.requeueInterrupted();
  }

  async enqueue(
    chatJid: string,
    message: OutgoingMessage,
    profile: string | null,
  ): Promise<OutboxRow> {
    const id = `o_${randomBytes(8).toString("hex")}`;
    let filePath: string | null = null;
    let payload: OutboxPayload;
    if (message.kind === "file") {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      filePath = join(this.dir, id);
      await writeFile(filePath, message.bytes, { mode: 0o600 });
      payload = {
        kind: "file",
        caption: message.caption,
        fileName: message.fileName,
        mimetype: message.mimetype,
        profile,
      };
    } else {
      payload = { kind: "text", text: message.text, profile };
    }
    const row = this.options.store.outbox.insert({
      id,
      messageId: generateMessageIDV2(this.options.me()?.pn),
      chatJid,
      payload,
      filePath,
      expiresAt: nowSeconds() + (this.options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    });
    this.flush();
    return row;
  }

  /** Starts sending what is queued now; during a run, another one follows it. */
  flush(): void {
    if (this.stopped) return;
    if (this.running) {
      this.flushAgain = true;
      return;
    }
    this.clearRetry();
    this.running = this.run()
      .catch((err: unknown) => this.options.logger.error({ err }, "outbox run failed"))
      .finally(() => {
        this.running = null;
        if (this.flushAgain) {
          this.flushAgain = false;
          this.flush();
        }
      });
  }

  /** Waits for the current run, if any; tests and shutdown use it. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  async expire(): Promise<void> {
    await removeCachedFiles(this.options.store.outbox.expire(), this.options.logger);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearRetry();
    await this.running;
  }

  private async run(): Promise<void> {
    await this.expire();
    while (!this.stopped) {
      const client = this.options.client();
      if (!client) return;
      const row = this.options.store.outbox.next();
      if (!row) return;
      if (row.expires_at <= nowSeconds()) {
        await this.expire();
        continue;
      }
      if (!(await this.attempt(client, row))) {
        this.scheduleRetry();
        return;
      }
    }
  }

  /** False when the send failed and the entry stays queued for a retry. */
  private async attempt(client: WhatsAppClient, row: OutboxRow): Promise<boolean> {
    const { store, logger } = this.options;
    let content;
    try {
      content = await buildOutgoingContent(await this.payloadOf(row));
    } catch (err) {
      logger.warn({ err, outboxId: row.id }, "could not prepare a queued message");
      store.outbox.finish(row.id, "failed", "the message could not be prepared");
      await this.removeFile(row);
      return true;
    }

    store.outbox.markSending(row.id);
    try {
      await client.sendMessage(row.chat_jid, content, { messageId: row.message_id });
    } catch (err) {
      logger.warn({ err, outboxId: row.id }, "sending failed, will retry");
      store.outbox.finish(row.id, "queued", "sending failed, retrying");
      return false;
    }
    store.outbox.finish(row.id, "sent");
    await this.removeFile(row);
    this.failures = 0;
    return true;
  }

  private async payloadOf(row: OutboxRow): Promise<OutgoingPayload> {
    const payload = JSON.parse(row.payload) as OutboxPayload;
    if (payload.kind === "text") return { text: payload.text };
    if (!row.file_path) throw new Error("queued file is missing");
    const bytes = await readFile(row.file_path);
    return {
      file: { bytes, name: payload.fileName, mimetype: payload.mimetype ?? undefined },
      caption: payload.caption ?? undefined,
    };
  }

  private scheduleRetry(): void {
    this.failures++;
    const backoff = this.options.backoff ?? DEFAULT_BACKOFF;
    const delay = Math.min(backoff.baseMs * 2 ** (this.failures - 1), backoff.maxMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flush();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private async removeFile(row: OutboxRow): Promise<void> {
    if (row.file_path) await removeCachedFiles([row.file_path], this.options.logger);
  }
}
