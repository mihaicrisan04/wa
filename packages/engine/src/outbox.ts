import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateMessageIDV2, type AnyMessageContent } from "@whiskeysockets/baileys";
import { backoffDelay, DEFAULT_BACKOFF, type Backoff } from "./backoff";
import { nowSeconds } from "./clock";
import { outboxDir } from "./config";
import { removeFiles, writeFileAtomic } from "./fs";
import type { Logger } from "./logger";
import type { OutboxRow, Store } from "./store";
import type { WhatsAppClient } from "./whatsapp/client";
import type { OwnIdentity } from "./whatsapp/connection";
import {
  buildOutgoingContent,
  type OutgoingContent,
  type OutgoingMessage,
} from "./whatsapp/outgoing";

export interface OutboxOptions {
  store: Store;
  /** `WA_HOME`; uploaded files wait in `WA_HOME/outbox/<id>`. */
  home: string;
  logger: Logger;
  /** The socket when the connection is open, null otherwise. */
  client: () => WhatsAppClient | null;
  me: () => OwnIdentity | null;
  backoff?: Backoff;
}

/** How long an entry may wait before it expires instead of going out late. */
const TTL_SECONDS = 60 * 60;
/** Failed sends before an entry is given up on, so one bad entry can't hold up the queue. */
const MAX_ATTEMPTS = 8;

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
    this.dir = outboxDir(options.home);
    options.store.outbox.requeueInterrupted();
  }

  async enqueue(
    chatJid: string,
    message: OutgoingMessage,
    profile: string | null,
  ): Promise<OutboxRow> {
    const id = `o_${randomBytes(8).toString("hex")}`;
    const filePath = message.kind === "file" ? await this.keepFile(id, message.bytes) : null;
    const row = this.options.store.outbox.insert({
      id,
      messageId: generateMessageIDV2(this.options.me()?.pn),
      chatJid,
      profile,
      payload: contentOf(message),
      filePath,
      expiresAt: nowSeconds() + TTL_SECONDS,
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
    await removeFiles(this.options.store.outbox.expire(), this.options.logger);
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
    const content = await this.prepare(row);
    if (!content) return true;

    store.outbox.markSending(row.id);
    try {
      await client.sendMessage(row.chat_jid, content, { messageId: row.message_id });
      store.outbox.finish(row.id, "sent");
    } catch (err) {
      const attempts = row.attempts + 1;
      if (attempts < MAX_ATTEMPTS) {
        logger.warn({ err, outboxId: row.id, attempts }, "sending failed, will retry");
        store.outbox.finish(row.id, "queued", "sending failed, retrying");
        return false;
      }
      logger.warn({ err, outboxId: row.id, attempts }, "sending failed, giving up");
      store.outbox.finish(row.id, "failed", `sending failed after ${attempts} attempts`);
    }
    await this.removeFile(row);
    this.failures = 0;
    return true;
  }

  /** Null when the entry can't be sent at all: it is marked failed and its file removed. */
  private async prepare(row: OutboxRow): Promise<AnyMessageContent | null> {
    try {
      return await buildOutgoingContent(await messageOf(row));
    } catch (err) {
      this.options.logger.warn({ err, outboxId: row.id }, "could not prepare a queued message");
      this.options.store.outbox.finish(row.id, "failed", "the message could not be prepared");
      await this.removeFile(row);
      return null;
    }
  }

  private async keepFile(id: string, bytes: Uint8Array): Promise<string> {
    const path = join(this.dir, id);
    await writeFileAtomic(path, bytes);
    return path;
  }

  private scheduleRetry(): void {
    this.failures++;
    const delay = backoffDelay(this.options.backoff ?? DEFAULT_BACKOFF, this.failures);
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
    if (row.file_path) await removeFiles([row.file_path], this.options.logger);
  }
}

function contentOf(message: OutgoingMessage): OutgoingContent {
  if (message.kind === "text") return message;
  const { bytes: _bytes, ...file } = message;
  return file;
}

async function messageOf({ payload, file_path }: OutboxRow): Promise<OutgoingMessage> {
  if (payload.kind === "text") return payload;
  if (!file_path) throw new Error("queued file is missing");
  return { ...payload, bytes: await readFile(file_path) };
}
