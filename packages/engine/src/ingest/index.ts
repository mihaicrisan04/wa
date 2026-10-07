import type { WAMessageKey, proto } from "@whiskeysockets/baileys";
import { removeFiles } from "../fs";
import type { Logger } from "../logger";
import type { Store } from "../store";
import type { WhatsAppClient } from "../whatsapp/client";
import type { OwnIdentity } from "../whatsapp/connection";
import { chatOf } from "../whatsapp/normalize";
import { Identity } from "../whatsapp/identity";
import { parseRaw } from "../whatsapp/raw";
import { deleteChats, ingestChat, ingestChatUpdate, ingestContact } from "./chats-contacts";
import { ingestContext, type Batch, type IngestContext } from "./context";
import { GroupCache, ingestGroup, ingestParticipantsUpdate } from "./groups";
import { ingestHistory, recordHistoryStatus, type HistoryPage } from "./history";
import { learnMapping, lookupLids, mappingsIn, unmappedLids } from "./lid";
import {
  applyActions,
  carriersOf,
  deleteMessages,
  ingestMessageUpdates,
  normalizeMessages,
  storeMessages,
} from "./messages";

export interface IngestOptions {
  store: Store;
  logger: Logger;
  /** Own identity from the persisted credentials. */
  me: () => OwnIdentity | null;
  groups?: GroupCache;
}

/**
 * Turns Baileys event batches into store writes: one SQLite transaction per batch, batches
 * strictly one after another.
 */
export class Ingest {
  readonly groups: GroupCache;
  private queue: Promise<void> = Promise.resolve();
  private readonly pageListeners = new Set<(page: HistoryPage) => void>();

  constructor(private readonly options: IngestOptions) {
    this.groups = options.groups ?? new GroupCache();
  }

  /** Subscribes to a socket's events; Baileys drops the listener when the socket is retired. */
  attach(client: WhatsAppClient): void {
    client.ev.process((batch) => this.handle(batch, client));
  }

  /** Resolves once this batch (and every earlier one) is stored. */
  handle(batch: Batch, client?: WhatsAppClient): Promise<void> {
    const run = this.queue.then(() => this.process(batch, client));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Resolves once every batch handed over so far is stored. */
  drain(): Promise<void> {
    return this.queue;
  }

  /** Called with every stored answer to an on-demand history request. */
  onHistoryPage(listener: (page: HistoryPage) => void): () => void {
    this.pageListeners.add(listener);
    return () => this.pageListeners.delete(listener);
  }

  /** Content of a stored message, for Baileys to answer retry receipts. */
  messageContent(key: WAMessageKey): proto.IMessage | undefined {
    if (!key.remoteJid || !key.id) return undefined;
    const identity = new Identity(this.options.store, this.options.me());
    const row = this.options.store.messages.get({ chatJid: chatOf(key, identity), id: key.id });
    if (!row?.raw || row.deleted_at !== null) return undefined;
    return parseRaw(row.raw).message ?? undefined;
  }

  private async process(batch: Batch, client: WhatsAppClient | undefined): Promise<void> {
    const { store, logger } = this.options;
    const me = this.options.me();
    const mappings = mappingsIn(batch, me);
    if (client) {
      const unknown = unmappedLids(batch, mappings, store);
      mappings.push(...(await lookupLids(client, unknown, logger)));
    }

    const ctx = ingestContext(store, new Identity(store, me), logger);
    let page: HistoryPage | null;
    try {
      page = store.transaction(() => {
        for (const mapping of mappings) learnMapping(ctx, mapping);
        return apply(ctx, batch);
      });
    } catch (err) {
      logger.error({ err, events: Object.keys(batch) }, "could not store a WhatsApp event batch");
      return;
    }
    this.groups.apply(batch);
    if (page) for (const listener of this.pageListeners) listener(page);
    await removeFiles(ctx.orphanedFiles, logger);
  }
}

/** Order matters: chats and people exist before messages, deletes come last. */
function apply(ctx: IngestContext, batch: Batch): HistoryPage | null {
  const history = batch["messaging-history.set"];
  const historyMessages = normalizeMessages(ctx, history?.messages ?? [], "history");
  const liveMessages = normalizeMessages(ctx, batch["messages.upsert"]?.messages ?? [], "live");
  const carriers = carriersOf(historyMessages, liveMessages);

  const page = history ? ingestHistory(ctx, history, historyMessages, carriers) : null;
  const status = batch["messaging-history.status"];
  if (status) recordHistoryStatus(ctx, status);

  for (const chat of batch["chats.upsert"] ?? []) ingestChat(ctx, chat);
  for (const chat of batch["chats.update"] ?? []) ingestChatUpdate(ctx, chat);
  for (const contact of batch["contacts.upsert"] ?? []) ingestContact(ctx, contact);
  for (const contact of batch["contacts.update"] ?? []) ingestContact(ctx, contact);
  for (const group of batch["groups.upsert"] ?? []) ingestGroup(ctx, group);
  for (const group of batch["groups.update"] ?? []) ingestGroup(ctx, group);
  const participants = batch["group-participants.update"];
  if (participants) ingestParticipantsUpdate(ctx, participants);

  storeMessages(ctx, liveMessages, carriers);
  applyActions(ctx, carriers.actions);
  ingestMessageUpdates(ctx, batch["messages.update"] ?? []);

  const deleted = batch["messages.delete"];
  if (deleted) deleteMessages(ctx, deleted);
  deleteChats(ctx, batch["chats.delete"] ?? []);
  return page;
}

export type { HistoryPage } from "./history";
export { reindex, type ReindexResult } from "./reindex";
