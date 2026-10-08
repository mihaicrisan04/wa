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

/** A full-text match: which message, where it ranks and the matching snippet. */
export interface SearchRow {
  rowid: number;
  chat_jid: string;
  id: string;
  ts: number;
  snippet: string;
  rank: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  /** Any further condition on the messages row `m` (access scope, filters). */
  where?: { sql: string; params: Record<string, string | number | null> };
}
