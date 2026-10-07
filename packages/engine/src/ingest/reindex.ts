import type { Logger } from "../logger";
import type { Store } from "../store";
import type { OwnIdentity } from "../whatsapp/connection";
import { normalizeMessage } from "../whatsapp/normalize";
import { parseRaw } from "../whatsapp/raw";
import { Identity } from "./lid";

export interface ReindexResult {
  rewritten: number;
  /** Rows without a raw payload (view-once, spoofed edits) or no longer storable. */
  skipped: number;
}

const PAGE_SIZE = 500;

/**
 * Re-normalizes every message from its `raw`. Edit and revoke times are event history, not
 * derivable from `raw`, so they are kept.
 */
export function reindex(store: Store, me: OwnIdentity | null, logger: Logger): ReindexResult {
  // first make the search index match the rows, so the update triggers can maintain it
  store.db.run("INSERT INTO messages_fts (messages_fts) VALUES ('rebuild')");
  const identity = new Identity(store, me);
  const result: ReindexResult = { rewritten: 0, skipped: 0 };
  let after = 0;
  for (;;) {
    // the engine may write meanwhile: read each page under the write lock, so no row goes stale
    const rows = store.writeTransaction(() => {
      const page = store.messages.page(after, PAGE_SIZE);
      for (const row of page) {
        after = row.rowid;
        const normalized = row.raw ? safeNormalize(row.raw, row.source, identity, logger) : null;
        if (normalized?.kind !== "message") {
          result.skipped++;
          continue;
        }
        const { record } = normalized;
        store.messages.rewrite(row.rowid, record);
        if (record.media && row.deleted_at === null) {
          store.media.upsert({ chatJid: row.chat_jid, id: row.id }, record.media);
        }
        result.rewritten++;
      }
      return page;
    });
    if (!rows.length) break;
  }
  return result;
}

function safeNormalize(
  raw: string,
  source: "live" | "history",
  identity: Identity,
  logger: Logger,
): ReturnType<typeof normalizeMessage> | null {
  try {
    return normalizeMessage(parseRaw(raw), identity, source);
  } catch (err) {
    logger.warn({ err }, "could not re-read a stored message");
    return null;
  }
}
