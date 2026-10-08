import type { Page, SearchHit } from "@wa/sdk";
import { z } from "zod";
import { and, type SqlFragment } from "../policy";
import { chatNames } from "./chats";
import { decodeCursor, paginate, parseTime } from "./cursor";
import { limitParam, optionalText, requiredText } from "./fields";
import { messagesByRowid, visibleMessages } from "./messages";
import { resolveChat, resolveSender } from "./resolve";
import type { ReadContext } from "./rows";

export const searchQuery = z.object({
  q: requiredText,
  chat: optionalText,
  sender: optionalText,
  after: optionalText,
  before: optionalText,
  type: optionalText,
  limit: limitParam(50, 200),
  cursor: optionalText,
});
export type SearchQueryOptions = z.output<typeof searchQuery>;

const offsetCursor = z.tuple([z.number().int().min(0)]);

/** Full-text search over the visible messages, best matches first. */
export function searchMessages(ctx: ReadContext, options: SearchQueryOptions): Page<SearchHit> {
  const filters: SqlFragment[] = [visibleMessages(ctx)];
  if (options.chat) {
    filters.push({ sql: "m.chat_jid = $chat", params: { chat: resolveChat(ctx, options.chat) } });
  }
  if (options.sender) {
    const sender = resolveSender(ctx, options.sender);
    filters.push({ sql: "m.sender_jid = $sender", params: { sender } });
  }
  if (options.after) {
    filters.push({ sql: "m.ts > $after", params: { after: parseTime(options.after, "after") } });
  }
  if (options.before) {
    filters.push({
      sql: "m.ts < $before",
      params: { before: parseTime(options.before, "before") },
    });
  }
  if (options.type) filters.push({ sql: "m.type = $type", params: { type: options.type } });

  const [offset] = options.cursor ? decodeCursor(options.cursor, offsetCursor) : [0];
  const hits = ctx.store.messages.search(options.q, {
    where: and(...filters),
    limit: options.limit + 1,
    offset,
  });
  const page = paginate(hits, options.limit, () => [offset + options.limit]);
  const messages = messagesByRowid(
    ctx,
    page.items.map((hit) => hit.rowid),
  );
  const names = chatNames(ctx, [...new Set(page.items.map((hit) => hit.chat_jid))]);
  return {
    items: page.items.flatMap((hit) => {
      const message = messages.get(hit.rowid);
      if (!message) return [];
      return [
        {
          message,
          chatName: names.get(hit.chat_jid) ?? null,
          snippet: hit.snippet,
          rank: hit.rank,
        },
      ];
    }),
    nextCursor: page.nextCursor,
  };
}
