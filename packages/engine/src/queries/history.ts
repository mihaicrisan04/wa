import type { HistoryPhase as PhaseInfo, HistorySync } from "@wa/sdk";
import { readHistoryPhases, type HistoryPhase } from "../ingest";
import { nowSeconds, type Store } from "../store";

/** Baileys calls a sync paused after this long without a chunk; same rule for the full sync. */
export const HISTORY_STALL_SECONDS = 120;

/**
 * Baileys only reports completion for `initial_bootstrap` and `recent`; the full sync is done at
 * 100% and paused when chunks stop coming. The furthest phase seen decides the overall status.
 */
export function readHistorySync(store: Store, now: number = nowSeconds()): HistorySync {
  const phases = Object.entries(readHistoryPhases({ store }))
    .map(([syncType, phase]) => ({ syncType, ...phase }))
    .sort((a, b) => a.at - b.at);
  const latest = phases.at(-1);
  const furthest =
    phases.find((p) => p.syncType === "full") ?? phases.find((p) => p.syncType === "recent");
  const deciding = furthest ?? latest;
  return {
    progress: deciding?.progress ?? null,
    status: deciding ? statusOf(deciding, Boolean(furthest), now) : null,
    updatedAt: latest?.at ?? null,
    phases: phases.map(({ syncType, progress, status, chunks, at }): PhaseInfo => ({
      syncType,
      progress,
      status,
      chunks,
      updatedAt: at,
    })),
  };
}

function statusOf(phase: HistoryPhase, isFurthest: boolean, now: number): HistorySync["status"] {
  // an earlier phase completing (bootstrap) says nothing about the rest of the sync
  if (isFurthest && phase.status) return phase.status;
  if (isFurthest && phase.progress === 100) return "complete";
  return now - phase.at >= HISTORY_STALL_SECONDS ? "paused" : null;
}
