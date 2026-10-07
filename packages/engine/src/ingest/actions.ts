import {
  extractMessageContent,
  normalizeMessageContent,
  type proto,
  type WAMessage,
} from "@whiskeysockets/baileys";
import {
  PLACEHOLDER_TYPE,
  REVOKED_TYPE,
  type MessageRecord,
  type MessageRow,
  type PendingRevoke,
} from "../store";
import { applyEditedText, contentTypeOf, textOf, typeName } from "../whatsapp/content";
import { placeholder, revokedMessage, type MessageAction } from "../whatsapp/normalize";
import { parseRaw, serializeRaw } from "../whatsapp/raw";
import type { IngestContext } from "./context";
import { pairOf } from "./lid";

interface Target {
  chatJid: string;
  fromMe: boolean;
  senderJid: string | null;
}

/**
 * Applies an edit or revoke to a stored message, if whoever sent it may do so. Placeholders
 * count too, so a copy decrypted later cannot bring back what was edited or revoked.
 */
export function applyAction(ctx: IngestContext, action: MessageAction): void {
  const row = ctx.store.messages.get({ chatJid: action.chatJid, id: action.targetId });
  if (!row) {
    if (action.type === "revoke") awaitSender(ctx, action);
    return;
  }
  if (row.deleted_at !== null) return;
  const target = { chatJid: row.chat_jid, fromMe: row.from_me === 1, senderJid: row.sender_jid };
  if (isAuthorized(ctx, action, target)) {
    if (action.type === "edit") applyEdit(ctx, row, action);
    else applyRevoke(ctx, row, action.ts);
  } else if (action.type === "revoke" && !hasSender(target)) {
    awaitSender(ctx, action);
  } else {
    ctx.logger.warn(
      { chat: row.chat_jid, id: row.id, action: action.type },
      "ignoring an edit or revoke that does not come from the sender",
    );
  }
}

/** Edits come only from the sender; revokes also from a group admin. */
export function isAuthorized(
  ctx: IngestContext,
  action: Pick<MessageAction, "type" | "actor">,
  target: Target,
): boolean {
  const { actor } = action;
  const isSender = actor.fromMe
    ? target.fromMe
    : !target.fromMe && actor.jid !== null && actor.jid === target.senderJid;
  if (isSender) return true;
  if (action.type !== "revoke") return false;
  const actorJid = actor.fromMe ? ctx.identity.me() : actor.jid;
  if (!actorJid) return false;
  const role = ctx.store.participants.role(target.chatJid, actorJid);
  return role === "admin" || role === "superadmin";
}

/**
 * A copy of a message whose revoke came first is stored as a tombstone when that revoke turns
 * out genuine, so its content is never readable, not even for a moment. One that cannot be
 * checked until a LID is mapped keeps the copy a placeholder meanwhile.
 */
export function withPendingRevokes(ctx: IngestContext, record: MessageRecord): MessageRecord {
  if (record.deletedAt !== null || !hasSender(record)) return record;
  const key = { chatJid: record.chatJid, id: record.id };
  const pending = ctx.store.pendingRevokes.take(key);
  if (!pending.length) return record;
  const genuine = pending.find((revoke) =>
    isAuthorized(ctx, { type: "revoke", ...revoke }, record),
  );
  if (genuine) return revokedRecord(record, genuine.ts);
  const undecided = pending.filter((revoke) => addressedApart(revoke.actor.jid, record));
  if (undecided.length) {
    for (const revoke of undecided) ctx.store.pendingRevokes.add(key, revoke);
    return placeholder({ ...record, raw: null });
  }
  ctx.logger.warn(
    { chat: record.chatJid, id: record.id },
    "dropping a revoke that does not come from the sender",
  );
  return record;
}

/**
 * An incoming copy that loses to a stored edit Baileys folded in (or one applied before the
 * original decrypted) takes that edit on, so the original's media and quote are kept.
 */
export function withStoredEdit(ctx: IngestContext, record: MessageRecord): MessageRecord | null {
  if (!record.raw || record.type === PLACEHOLDER_TYPE) return null;
  const stored = ctx.store.messages.get({ chatJid: record.chatJid, id: record.id });
  if (!stored?.raw || stored.deleted_at !== null || stored.edited_at === null) return null;
  const edit = normalizeMessageContent(parseRaw(stored.raw).message?.editedMessage?.message);
  const message = parseRaw(record.raw);
  const original = normalizeMessageContent(message.message);
  if (!edit || !original) return null;
  applyEditedText(original, edit);
  const { text, caption } = textOf(extractMessageContent(message.message));
  return { ...record, text, caption, editedAt: stored.edited_at, raw: serializeRaw(message) };
}

function applyEdit(
  ctx: IngestContext,
  row: MessageRow,
  action: Extract<MessageAction, { type: "edit" }>,
): void {
  if (row.edited_at !== null && row.edited_at >= action.ts) return;
  const edited = normalizeMessageContent(action.content);
  if (!edited) return;
  const message = row.raw ? parseRaw(row.raw) : null;
  if (message) foldEdit(message, edited);
  const content = extractMessageContent(message?.message ?? edited);
  const type = contentTypeOf(content);
  if (!type) return;
  const { text, caption } = textOf(content);
  ctx.store.messages.applyEdit(
    { chatJid: row.chat_jid, id: row.id },
    {
      type: row.type === PLACEHOLDER_TYPE ? typeName(type) : row.type,
      text,
      caption,
      editedAt: action.ts,
      raw: message ? serializeRaw(message) : null,
    },
  );
}

/** Edits a stored message in place; one not decrypted yet holds just the edit, as Baileys folds it. */
function foldEdit(message: WAMessage, edited: proto.IMessage): void {
  const original = normalizeMessageContent(message.message);
  if (original) {
    applyEditedText(original, edited);
    return;
  }
  message.message = { editedMessage: { message: edited } };
  message.messageStubType = null;
}

function applyRevoke(ctx: IngestContext, row: MessageRow, deletedAt: number): void {
  const key = { chatJid: row.chat_jid, id: row.id };
  ctx.store.messages.tombstone(key, deletedAt, revokedRaw(row.raw));
  const file = ctx.store.media.remove(key);
  if (file) ctx.orphanedFiles.push(file);
}

/** Fails closed: a revoke whose target's sender is unknown waits for a copy that names it. */
function awaitSender(ctx: IngestContext, action: Extract<MessageAction, { type: "revoke" }>): void {
  const revoke: PendingRevoke = { actor: action.actor, ts: action.ts };
  ctx.store.pendingRevokes.add({ chatJid: action.chatJid, id: action.targetId }, revoke);
}

/** An unmapped LID and a PN may be the same person, so the revoke waits for the mapping. */
function addressedApart(actorJid: string | null, target: Target): boolean {
  const sender = target.fromMe ? null : target.senderJid;
  return pairOf(actorJid, sender) !== null;
}

function hasSender(target: Target): boolean {
  return target.fromMe || target.senderJid !== null;
}

function revokedRecord(record: MessageRecord, deletedAt: number): MessageRecord {
  return { ...placeholder(record), type: REVOKED_TYPE, deletedAt, raw: revokedRaw(record.raw) };
}

function revokedRaw(raw: string | null): string | null {
  return raw ? serializeRaw(revokedMessage(parseRaw(raw))) : null;
}
