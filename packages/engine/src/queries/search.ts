import type { Page, SearchHit } from "@wa/sdk";
import { z } from "zod";
import { and, type SqlFragment } from "../policy";
import { decodeCursor, encodeCursor, parseTime } from "./cursor";
import { messagesByRowid, visibleMessages } from "./messages";
import { resolveChat, resolveSender } from "./resolve";
import type { ReadContext } from "./rows";

export interface SearchQueryOptions {
  q: string;
  chat?: string;
  sender?: string;
  after?: string;
  before?: string;
  type?: string;
  limit: number;
  cursor?: string;
}

const offsetCursor = z.tuple([z.number().int().min(0)]);

/** Full-text search over the visible messages, best matches first. */
export function searchVisible(ctx: ReadContext, options: SearchQueryOptions): Page<SearchHit> {
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
  const hits = ctx.store.search(options.q, {
    where: and(...filters),
    limit: options.limit + 1,
    offset,
  });
  const page = hits.slice(0, options.limit);
  const messages = messagesByRowid(
    ctx,
    page.map((hit) => hit.rowid),
  );
  return {
    items: page.flatMap((hit) => {
      const message = messages.get(hit.rowid);
      return message ? [{ message, snippet: hit.snippet, rank: hit.rank }] : [];
    }),
    nextCursor: hits.length > options.limit ? encodeCursor([offset + options.limit]) : null,
  };
}
