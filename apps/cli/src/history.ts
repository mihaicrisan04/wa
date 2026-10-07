import type { HistoryPhase, HistorySync } from "@wa/sdk";

/** `complete`, `paused at 80%`, `in progress (45%)` or `not started`. */
export function syncSummary(history: HistorySync): string {
  const progress = history.progress === null ? null : `${Math.round(history.progress)}%`;
  if (history.status === "complete") return "complete";
  if (history.status === "paused") return progress ? `paused at ${progress}` : "paused";
  if (progress) return `in progress (${progress})`;
  return history.phases.length ? "in progress" : "not started";
}

/** `initial_bootstrap complete · recent 40% · push_name 1 chunk`. */
export function phasesSummary(history: HistorySync): string {
  return history.phases.map(phaseSummary).join(" · ");
}

function phaseSummary(phase: HistoryPhase): string {
  if (phase.status) return `${phase.syncType} ${phase.status}`;
  if (phase.progress !== null) return `${phase.syncType} ${Math.round(phase.progress)}%`;
  return `${phase.syncType} ${phase.chunks} chunk${phase.chunks === 1 ? "" : "s"}`;
}
