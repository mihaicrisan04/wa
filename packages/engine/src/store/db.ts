import { Database } from "bun:sqlite";
import { MIGRATIONS, type Migration } from "./migrations";

export type { Database };

/** Opens (creating if needed) the store and brings its schema up to date. */
export function openDatabase(path: string, migrations: Migration[] = MIGRATIONS): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  // the CLI may open the same file while the engine runs
  db.run("PRAGMA busy_timeout = 5000");
  migrate(db, migrations);
  return db;
}

export function migrate(db: Database, migrations: Migration[]): void {
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    db
      .query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.run(migration.sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($version, $at)").run({
        version: migration.version,
        at: nowSeconds(),
      });
    })();
  }
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
