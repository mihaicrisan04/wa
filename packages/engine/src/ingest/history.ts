import { proto, type BaileysEventMap } from "@whiskeysockets/baileys";
import { nowSeconds } from "../clock";
import type { HistoryPhaseState } from "../store";
import type { Normalized } from "../whatsapp/normalize";
import { ingestChat, ingestContact } from "./chats-contacts";
import type { IngestContext } from "./context";
import { ingestPastParticipants } from "./groups";
import { storeMessages, type Carriers } from "./messages";

const { HistorySyncType } = proto.HistorySync;

/** An answer to `fetchMessageHistory`, once it is stored. */
export interface HistoryPage {
  /** The request it answers, when WhatsApp says. */
  sessionId: string | null;
  /** Messages it carried, per canonical chat jid. */
  chats: Map<string, number>;
}

function syncTypeName(type: proto.HistorySync.HistorySyncType | null | undefined): string {
  if (type === null || type === undefined) return "unknown";
  return (HistorySyncType[type] ?? `type_${type}`).toLowerCase();
}

/** A history chunk or the consolidated first sync, of any type; returns an on-demand answer's page. */
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
    ...(phase.explicit === false ? resumed(phase) : phase),
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

function updatePhase(
  ctx: IngestContext,
  name: string,
  change: (phase: HistoryPhaseState) => Omit<HistoryPhaseState, "updatedAt">,
): void {
  const phases = ctx.store.sync.historyPhases();
  const current = phases[name] ?? {
    progress: null,
    status: null,
    explicit: null,
    chunks: 0,
    updatedAt: 0,
  };
  phases[name] = { ...change(current), updatedAt: nowSeconds() };
  ctx.store.sync.setHistoryPhases(phases);
}

/** A chunk after a pause Baileys guessed from silence: the sync was not paused after all. */
function resumed(phase: HistoryPhaseState): HistoryPhaseState {
  return { ...phase, status: null, explicit: null };
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
