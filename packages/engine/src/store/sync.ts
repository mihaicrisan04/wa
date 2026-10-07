import type { Database } from "./db";

/** Small JSON values about sync progress, keyed by name. */
export class SyncRepo {
  constructor(private readonly db: Database) {}

  get<T>(key: string): T | null {
    const row = this.db
      .query<{ value: string }, { key: string }>("SELECT value FROM sync_state WHERE key = $key")
      .get({ key });
    return row ? (JSON.parse(row.value) as T) : null;
  }

  set(key: string, value: unknown): void {
    this.db
      .query(
        `INSERT INTO sync_state (key, value) VALUES ($key, $value)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run({ key, value: JSON.stringify(value) });
  }
}
