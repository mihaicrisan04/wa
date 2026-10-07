import type { HistorySyncStatus } from "@wa/sdk";
import type { Database } from "./db";

/** What WhatsApp reported about one history sync type (`initial_bootstrap`, `recent`, `full`…). */
export interface HistoryPhaseState {
  /** 0-100 from the phase's last chunk. */
  progress: number | null;
  status: HistorySyncStatus | null;
  /** False when Baileys inferred the status from silence instead of WhatsApp saying so. */
  explicit: boolean | null;
  chunks: number;
  /** Unix seconds of the last chunk or status. */
  updatedAt: number;
}

/** Keyed by sync type name. */
export type HistoryPhases = Record<string, HistoryPhaseState>;

const HISTORY_PHASES = "history.phases";

/** `sync_state`: how far WhatsApp's history sync got. */
export class SyncRepo {
  constructor(private readonly db: Database) {}

  historyPhases(): HistoryPhases {
    const row = this.db
      .query<{ value: string }, { key: string }>("SELECT value FROM sync_state WHERE key = $key")
      .get({ key: HISTORY_PHASES });
    return row ? (JSON.parse(row.value) as HistoryPhases) : {};
  }

  setHistoryPhases(phases: HistoryPhases): void {
    this.db
      .query(
        `INSERT INTO sync_state (key, value) VALUES ($key, $value)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run({ key: HISTORY_PHASES, value: JSON.stringify(phases) });
  }

  /** A newly linked device gets a new history sync; the old one's progress would read as done. */
  clearHistoryPhases(): void {
    this.db.query("DELETE FROM sync_state WHERE key = $key").run({ key: HISTORY_PHASES });
  }
}
