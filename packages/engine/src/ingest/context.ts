import type { Logger } from "../logger";
import type { Store } from "../store";
import type { Identity } from "./lid";

/** What every ingest step gets while it runs inside the batch's transaction. */
export interface IngestContext {
  store: Store;
  identity: Identity;
  logger: Logger;
  /** Cached media files to delete once the transaction has committed. */
  orphanedFiles: string[];
}

/**
 * Runs one item's writes in a savepoint, so a message that fails to store is logged and
 * skipped instead of failing its whole batch (a consolidated history sync is one batch).
 */
export function isolated(
  ctx: IngestContext,
  what: Record<string, unknown>,
  work: () => void,
): void {
  try {
    ctx.store.transaction(work);
  } catch (err) {
    ctx.logger.error({ err, ...what }, "could not store an item, skipping it");
  }
}
