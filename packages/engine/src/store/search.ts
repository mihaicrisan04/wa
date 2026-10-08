import type { Database } from "./db";

const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * Turns free text into an FTS5 query that can't be a syntax error: every term is a quoted
 * phrase (so `-`, `:`, `+`, `'` and FTS operators are inert) and the last one is a prefix.
 * Returns null when nothing searchable is left.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .filter((term) => HAS_WORD.test(term))
    .map((term) => `"${term.replaceAll('"', '""')}"`);
  if (!terms.length) return null;
  terms[terms.length - 1] += "*";
  return terms.join(" ");
}

export interface SearchHit {
  rowid: number;
  chat_jid: string;
  id: string;
  ts: number;
  snippet: string;
  rank: number;
}

export interface SearchOptions {
  limit?: number;
  /** Restricts the search to these chats; scoping beyond that is the caller's job. */
  chatJids?: string[];
}

export const SNIPPET_OPEN = "\u0002";
export const SNIPPET_CLOSE = "\u0003";

/** Full-text search over text, captions and file names, best matches first. */
export function searchMessages(
  db: Database,
  input: string,
  options: SearchOptions = {},
): SearchHit[] {
  const query = toFtsQuery(input);
  if (!query) return [];
  const chats = options.chatJids;
  const chatFilter = chats ? `AND m.chat_jid IN (SELECT value FROM json_each($chats))` : "";
  return db
    .query<SearchHit, Record<string, string | number>>(
      `SELECT m.rowid, m.chat_jid, m.id, m.ts, f.rank,
         snippet(messages_fts, -1, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '…', 12) AS snippet
       FROM messages_fts AS f JOIN messages AS m ON m.rowid = f.rowid
       WHERE messages_fts MATCH $query AND m.deleted_at IS NULL ${chatFilter}
       ORDER BY f.rank, m.ts DESC
       LIMIT $limit`,
    )
    .all({
      query,
      limit: options.limit ?? 50,
      ...(chats ? { chats: JSON.stringify(chats) } : {}),
    });
}
