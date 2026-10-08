import { MEDIA_KINDS, type MediaInfo } from "@wa/sdk";
import { z } from "zod";
import { notFound } from "../errors";
import { can, type SqlParams } from "../policy";
import type { MediaRow } from "../store";
import { limitParam, optionalText } from "./fields";
import { visibleMessages } from "./messages";
import { contactName, likePattern, type ReadContext } from "./rows";

export const mediaListQuery = z.object({
  kind: z.enum(MEDIA_KINDS).optional(),
  /** Matches file names, and captions when the principal may read messages. */
  query: optionalText,
  limit: limitParam(30, 200),
});
export type MediaListOptions = z.output<typeof mediaListQuery>;

export interface MediaItem extends MediaInfo {
  ts: number;
  fromMe: boolean;
  sender: string | null;
  senderName: string | null;
  /** Only for principals that may read messages. */
  caption: string | null;
}

type MediaItemRow = MediaRow & {
  ts: number;
  from_me: number;
  sender_jid: string | null;
  sender_name: string | null;
  caption: string | null;
};

/** Downloadable media of one visible chat, newest first; view-once media never is. */
export function listMedia(
  ctx: ReadContext,
  chatJid: string,
  options: MediaListOptions,
): MediaItem[] {
  const captions = can(ctx.principal, "messages:read");
  const visible = visibleMessages(ctx);
  const rows = ctx.store.db
    .query<MediaItemRow, SqlParams>(
      `SELECT md.*, m.ts, m.from_me, m.sender_jid, m.caption, ${contactName("sc")} AS sender_name
       FROM media AS md
       JOIN messages AS m ON m.chat_jid = md.chat_jid AND m.id = md.message_id
       LEFT JOIN contacts AS sc ON sc.jid = m.sender_jid
       WHERE md.chat_jid = $chat AND m.deleted_at IS NULL AND m.view_once = 0
         AND ($kind IS NULL OR md.kind = $kind)
         AND ($pattern IS NULL OR md.file_name LIKE $pattern ESCAPE '\\'
           OR ($captions = 1 AND m.caption LIKE $pattern ESCAPE '\\'))
         AND (${visible.sql})
       ORDER BY m.ts DESC, m.rowid DESC LIMIT $limit`,
    )
    .all({
      ...visible.params,
      chat: chatJid,
      kind: options.kind ?? null,
      pattern: options.query ? likePattern(options.query) : null,
      captions: captions ? 1 : 0,
      limit: options.limit,
    });
  return rows.map((row) => ({
    ...toMediaInfo(row),
    ts: row.ts,
    fromMe: row.from_me === 1,
    sender: row.sender_jid,
    senderName: row.sender_name,
    caption: captions ? row.caption : null,
  }));
}

/** Media a visible, not deleted message carries. */
export function findMedia(ctx: ReadContext, chatJid: string, id: string): MediaRow {
  const visible = visibleMessages(ctx);
  const row = ctx.store.db
    .query<MediaRow, SqlParams>(
      `SELECT md.* FROM media AS md
       JOIN messages AS m ON m.chat_jid = md.chat_jid AND m.id = md.message_id
       WHERE md.chat_jid = $chat AND md.message_id = $id AND m.deleted_at IS NULL
         AND (${visible.sql})`,
    )
    .get({ ...visible.params, chat: chatJid, id });
  if (!row) throw notFound("media not found");
  return row;
}

export function toMediaInfo(row: MediaRow): MediaInfo {
  return {
    chat: row.chat_jid,
    id: row.message_id,
    kind: row.kind,
    mimetype: row.mimetype,
    fileName: row.file_name,
    size: row.size,
    downloaded: row.local_path !== null,
  };
}
