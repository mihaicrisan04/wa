import type { HistoryPhase, HistorySync } from "@wa/sdk";
import { nowSeconds } from "../clock";
import type { HistoryPhaseState, Store } from "../store";

/** Baileys calls a sync paused after this long without a chunk; same rule for the full sync. */
export const HISTORY_STALL_SECONDS = 120;

/**
 * Only the full sync finishing finishes the sync. Baileys reports completion for
 * `initial_bootstrap` and `recent` only, so the full sync is done at 100% and, like any phase,
 * paused when chunks stop coming. The furthest phase seen decides the overall status.
 */
export function readHistorySync(store: Store, now: number = nowSeconds()): HistorySync {
  const phases = Object.entries(store.sync.historyPhases())
    .map(([syncType, phase]) => ({ syncType, ...phase }))
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const latest = phases.at(-1);
  const deciding =
    phases.find((p) => p.syncType === "full") ??
    phases.find((p) => p.syncType === "recent") ??
    latest;
  return {
    progress: deciding?.progress ?? null,
    status: deciding ? overallStatus(deciding, now) : null,
    updatedAt: latest?.updatedAt ?? null,
    phases: phases.map(({ syncType, progress, status, chunks, updatedAt }): HistoryPhase => ({
      syncType,
      progress,
      status,
      chunks,
      updatedAt,
    })),
  };
}

function overallStatus(
  phase: HistoryPhaseState & { syncType: string },
  now: number,
): HistorySync["status"] {
  const fullDone = phase.status === "complete" || phase.progress === 100;
  if (phase.syncType === "full" && fullDone) return "complete";
  if (phase.status === "paused") return "paused";
  return now - phase.updatedAt >= HISTORY_STALL_SECONDS ? "paused" : null;
}
