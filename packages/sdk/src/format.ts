import type { HistoryPhase, HistorySync } from "./types";

/** `1 chat`, `2 chats`, `1,234 messages`. */
export function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

/** `complete`, `paused at 80%`, `in progress (45%)` or `not started`. */
export function syncSummary(history: HistorySync): string {
  const progress = history.progress === null ? null : `${Math.round(history.progress)}%`;
  if (history.status === "complete") return "complete";
  if (history.status === "paused") return progress ? `paused at ${progress}` : "paused";
  if (progress) return `in progress (${progress})`;
  return history.phases.length ? "in progress" : "not started";
}

/** `initial_bootstrap complete`, `recent 40%` or `push_name 1 chunk`. */
export function phaseSummary(phase: HistoryPhase): string {
  if (phase.status) return `${phase.syncType} ${phase.status}`;
  if (phase.progress !== null) return `${phase.syncType} ${Math.round(phase.progress)}%`;
  return `${phase.syncType} ${plural(phase.chunks, "chunk")}`;
}

/** `+40712345678` for a phone-number jid (device suffix dropped), null for groups, LIDs, etc. */
export function phoneOf(jid: string | null): string | null {
  const match = jid ? /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid) : null;
  return match ? `+${match[1]}` : null;
}
