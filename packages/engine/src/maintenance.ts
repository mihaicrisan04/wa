import { stat } from "node:fs/promises";
import { databasePath } from "./config";
import { reindex, type ReindexResult } from "./ingest";
import type { Logger } from "./logger";
import { openStore } from "./store";
import { readOwnIdentity } from "./whatsapp/connection";

/** `wa reindex`: works on the database file directly, so it runs with or without the engine. */
export async function reindexHome(home: string, logger: Logger): Promise<ReindexResult | null> {
  const path = databasePath(home);
  if (!(await stat(path).catch(() => null))?.isFile()) return null;
  const me = await readOwnIdentity(home);
  const store = openStore(path);
  try {
    return reindex(store, me, logger);
  } finally {
    store.close();
  }
}
