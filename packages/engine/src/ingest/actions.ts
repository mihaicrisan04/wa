import {
  extractMessageContent,
  normalizeMessageContent,
  proto,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { PLACEHOLDER_TYPE, type MessageRow } from "../store";
import { applyEditedText, textOf } from "../whatsapp/content";
import type { MessageAction } from "../whatsapp/normalize";
import { parseRaw, serializeRaw } from "../whatsapp/raw";
import type { IngestContext } from "./context";

interface Target {
  chatJid: string;
  fromMe: boolean;
  senderJid: string | null;
}

/** Applies an edit or revoke to a stored message, if whoever sent it may do so. */
export function applyAction(ctx: IngestContext, action: MessageAction): void {
  const row = ctx.store.messages.get(action.chatJid, action.targetId);
  if (!row || row.deleted_at !== null || row.type === PLACEHOLDER_TYPE) return;
  const target = { chatJid: row.chat_jid, fromMe: row.from_me === 1, senderJid: row.sender_jid };
  if (!isAuthorized(ctx, action, target)) {
    ctx.logger.warn(
      { chat: row.chat_jid, id: row.id, action: action.type },
      "ignoring an edit or revoke that does not come from the sender",
    );
    return;
  }
  if (action.type === "edit") applyEdit(ctx, row, action);
  else applyRevoke(ctx, row, action.ts);
}

/** Edits come only from the sender; revokes also from a group admin. */
export function isAuthorized(ctx: IngestContext, action: MessageAction, target: Target): boolean {
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

function applyEdit(
  ctx: IngestContext,
  row: MessageRow,
  action: Extract<MessageAction, { type: "edit" }>,
): void {
  if (row.edited_at !== null && row.edited_at >= action.ts) return;
  const edited = normalizeMessageContent(action.content);
  if (!edited) return;
  let raw = row.raw;
  let content: proto.IMessage | undefined = extractMessageContent(edited);
  if (row.raw) {
    const message = parseRaw(row.raw);
    const original = normalizeMessageContent(message.message);
    if (original) applyEditedText(original, edited);
    raw = serializeRaw(message);
    content = extractMessageContent(message.message);
  }
  const { text, caption } = textOf(content);
  ctx.store.messages.applyEdit(
    { chatJid: row.chat_jid, id: row.id },
    { text, caption, editedAt: action.ts, raw },
  );
}

function applyRevoke(ctx: IngestContext, row: MessageRow, deletedAt: number): void {
  const key = { chatJid: row.chat_jid, id: row.id };
  ctx.store.messages.tombstone(key, deletedAt, row.raw ? tombstoneRaw(parseRaw(row.raw)) : null);
  const file = ctx.store.media.remove(key);
  if (file) ctx.orphanedFiles.push(file);
}

/** What a revoked message looks like in history: its key and time, no content. */
function tombstoneRaw(original: WAMessage): string {
  return serializeRaw({
    key: original.key,
    messageTimestamp: original.messageTimestamp,
    messageStubType: proto.WebMessageInfo.StubType.REVOKE,
    message: null,
  });
}
