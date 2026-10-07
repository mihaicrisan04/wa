import type { Logger } from "../logger";
import type { MessageRow, Store } from "../store";
import type { OwnIdentity } from "../whatsapp/connection";
import { normalizeMessage, revokedMessage } from "../whatsapp/normalize";
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
        const normalized = safeNormalize(row, identity, logger);
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

/** A tombstone is re-read without content, whatever its raw still holds. */
function safeNormalize(
  row: MessageRow,
  identity: Identity,
  logger: Logger,
): ReturnType<typeof normalizeMessage> | null {
  if (!row.raw) return null;
  try {
    const message = parseRaw(row.raw);
    const current = row.deleted_at === null ? message : revokedMessage(message);
    return normalizeMessage(current, identity, row.source);
  } catch (err) {
    logger.warn({ err }, "could not re-read a stored message");
    return null;
  }
}
