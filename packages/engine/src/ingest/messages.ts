import {
  isLidUser,
  isPnUser,
  type BaileysEventMap,
  type WAMessage,
  type WAMessageUpdate,
} from "@whiskeysockets/baileys";
import type { MessageRecord } from "../store";
import {
  actionFromUpdate,
  chatOf,
  normalizeMessage,
  placeholder,
  type MessageAction,
} from "../whatsapp/normalize";
import { applyAction, isAuthorized } from "./actions";
import { isolated, type IngestContext } from "./context";

/**
 * Stores a batch of messages, then applies the edits and revokes it carried. Carriers are
 * never stored as rows.
 */
export function ingestMessages(
  ctx: IngestContext,
  messages: WAMessage[],
  source: MessageRecord["source"],
): void {
  const normalized = messages.flatMap((message) => {
    try {
      return [normalizeMessage(message, ctx.identity, source)];
    } catch (err) {
      ctx.logger.error({ err, id: message.key?.id }, "could not read a message, skipping it");
      return [];
    }
  });
  const actions = normalized.flatMap((item) =>
    item.kind === "carrier" && item.action ? [item.action] : [],
  );
  const revokeCarriers = new Set(
    actions.flatMap((action) =>
      action.type === "revoke" && action.carrierId
        ? [refKey(action.chatJid, action.carrierId)]
        : [],
    ),
  );

  for (const item of normalized) {
    if (item.kind !== "message") continue;
    // Baileys folds a buffered revoke onto its target by overwriting the key with the carrier's
    if (
      item.record.deletedAt !== null &&
      revokeCarriers.has(refKey(item.record.chatJid, item.record.id))
    )
      continue;
    const { record, pushName, foldedEdit } = item;
    isolated(ctx, { id: record.id }, () => {
      writeMessage(ctx, foldedEdit ? checkFoldedEdit(ctx, record, actions) : record, pushName);
    });
  }
  for (const action of actions)
    isolated(ctx, { id: action.targetId }, () => applyAction(ctx, action));
}

export function ingestMessageUpdates(ctx: IngestContext, updates: WAMessageUpdate[]): void {
  for (const update of updates) {
    const action = actionFromUpdate(update, ctx.identity);
    if (action) isolated(ctx, { id: action.targetId }, () => applyAction(ctx, action));
  }
}

/** Delete-for-me and chat clears: the rows, their search entries and cached media go. */
export function deleteMessages(ctx: IngestContext, data: BaileysEventMap["messages.delete"]): void {
  const { store, identity } = ctx;
  if ("all" in data) {
    const jid = identity.chat(data.jid);
    ctx.orphanedFiles.push(...store.media.removeChat(jid));
    store.messages.deleteChat(jid);
    return;
  }
  for (const key of data.keys) {
    if (!key.remoteJid || !key.id) continue;
    const ref = { chatJid: chatOf(key, identity), id: key.id };
    const file = store.media.remove(ref);
    if (file) ctx.orphanedFiles.push(file);
    store.messages.delete(ref);
  }
}

/**
 * A folded edit carries the editor only on its carrier; when that carrier shows someone other
 * than the sender, the spoofed content is dropped and the row waits for a genuine copy.
 */
function checkFoldedEdit(
  ctx: IngestContext,
  record: MessageRecord,
  actions: MessageAction[],
): MessageRecord {
  const carrier = actions.find(
    (action) =>
      action.type === "edit" && action.chatJid === record.chatJid && action.targetId === record.id,
  );
  if (!carrier || isAuthorized(ctx, carrier, record)) return record;
  ctx.logger.warn(
    { chat: record.chatJid, id: record.id },
    "dropping an edit that does not come from the sender",
  );
  return placeholder({ ...record, raw: null });
}

function writeMessage(ctx: IngestContext, record: MessageRecord, pushName: string | null): void {
  const { store, identity } = ctx;
  store.chats.ensure(record.chatJid, identity.kindOf(record.chatJid));
  if (!store.messages.upsert(record)) return;

  const ref = { chatJid: record.chatJid, id: record.id };
  if (record.media && record.deletedAt === null) store.media.upsert(ref, record.media);
  else {
    const file = store.media.remove(ref);
    if (file) ctx.orphanedFiles.push(file);
  }
  store.chats.touch(record.chatJid, record.ts);

  const sender = record.senderJid;
  if (pushName && !record.fromMe && sender && (isPnUser(sender) || isLidUser(sender))) {
    store.contacts.upsert(sender, { pushName });
  }
}

function refKey(chatJid: string, id: string): string {
  return `${chatJid}\u0000${id}`;
}
