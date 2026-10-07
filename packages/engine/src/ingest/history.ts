import { proto, type BaileysEventMap } from "@whiskeysockets/baileys";
import type { Normalized } from "../whatsapp/normalize";
import { nowSeconds } from "../store";
import { ingestChat, ingestContact } from "./chats-contacts";
import type { IngestContext } from "./context";
import { ingestPastParticipants } from "./groups";
import { storeMessages, type Carriers } from "./messages";

const { HistorySyncType } = proto.HistorySync;

export const HISTORY_PHASES_KEY = "history.phases";

/** What WhatsApp reported about one history sync type (`initial_bootstrap`, `recent`, `full`…). */
export interface HistoryPhase {
  /** 0-100 from the phase's last chunk. */
  progress: number | null;
  status: "complete" | "paused" | null;
  /** False when Baileys inferred the status from silence instead of WhatsApp saying so. */
  explicit: boolean | null;
  chunks: number;
  /** Unix seconds of the last chunk or status. */
  at: number;
}

export type HistoryPhases = Record<string, HistoryPhase>;

/** An answer to `fetchMessageHistory`, once it is stored. */
export interface HistoryPage {
  /** The request it answers, when WhatsApp says. */
  sessionId: string | null;
  /** Messages it carried, per canonical chat jid. */
  chats: Map<string, number>;
}

export function syncTypeName(type: proto.HistorySync.HistorySyncType | null | undefined): string {
  if (type === null || type === undefined) return "unknown";
  return (HistorySyncType[type] ?? `type_${type}`).toLowerCase();
}

/**
 * A history chunk, or the whole consolidated first sync. Everything is ingested whatever the
 * sync type; messages come only from `messages` (each chat's own list is truncated), passed in
 * already normalized. Returns the page when it answers an on-demand request.
 */
export function ingestHistory(
  ctx: IngestContext,
  data: BaileysEventMap["messaging-history.set"],
  messages: Normalized[],
  carriers: Carriers,
): HistoryPage | null {
  for (const chat of data.chats) ingestChat(ctx, chat);
  for (const contact of data.contacts) ingestContact(ctx, contact);
  ingestPastParticipants(ctx, data.pastParticipants ?? []);
  storeMessages(ctx, messages, carriers);

  // on-demand pages answer `wa backfill`; they say nothing about the initial sync
  if (data.syncType === HistorySyncType.ON_DEMAND) {
    return { sessionId: data.peerDataRequestSessionId ?? null, chats: chatCounts(messages) };
  }
  updatePhase(ctx, syncTypeName(data.syncType), (phase) => ({
    ...phase,
    progress: data.progress ?? phase.progress,
    chunks: phase.chunks + 1,
  }));
  return null;
}

/** `isLatest` does not mean done; this event does, per sync type. */
export function recordHistoryStatus(
  ctx: IngestContext,
  { syncType, status, explicit }: BaileysEventMap["messaging-history.status"],
): void {
  updatePhase(ctx, syncTypeName(syncType), (phase) => ({ ...phase, status, explicit }));
}

export function readHistoryPhases(ctx: Pick<IngestContext, "store">): HistoryPhases {
  return ctx.store.sync.get<HistoryPhases>(HISTORY_PHASES_KEY) ?? {};
}

function updatePhase(
  ctx: IngestContext,
  name: string,
  change: (phase: HistoryPhase) => Omit<HistoryPhase, "at">,
): void {
  const phases = readHistoryPhases(ctx);
  const current = phases[name] ?? {
    progress: null,
    status: null,
    explicit: null,
    chunks: 0,
    at: 0,
  };
  phases[name] = { ...change(current), at: nowSeconds() };
  ctx.store.sync.set(HISTORY_PHASES_KEY, phases);
}

function chatCounts(messages: Normalized[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of messages) {
    if (item.kind !== "message") continue;
    const chat = item.record.chatJid;
    counts.set(chat, (counts.get(chat) ?? 0) + 1);
  }
  return counts;
}
