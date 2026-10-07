import { proto, type BaileysEventMap } from "@whiskeysockets/baileys";
import { nowSeconds } from "../store";
import { ingestChat, ingestContact } from "./chats-contacts";
import type { IngestContext } from "./context";
import { ingestPastParticipants } from "./groups";
import { ingestMessages } from "./messages";

export const HISTORY_PROGRESS_KEY = "history.progress";
export const HISTORY_STATUS_KEY = "history.status";

export interface HistoryProgress {
  syncType: proto.HistorySync.HistorySyncType | null;
  progress: number | null;
  isLatest: boolean;
  chunkOrder: number | null;
  at: number;
}

export type HistoryStatus = BaileysEventMap["messaging-history.status"] & { at: number };

/**
 * A history chunk, or the whole consolidated first sync. Everything is ingested whatever the
 * sync type; messages come only from `messages` (each chat's own list is truncated).
 */
export function ingestHistory(
  ctx: IngestContext,
  data: BaileysEventMap["messaging-history.set"],
): void {
  for (const chat of data.chats) ingestChat(ctx, chat);
  for (const contact of data.contacts) ingestContact(ctx, contact);
  ingestPastParticipants(ctx, data.pastParticipants ?? []);
  ingestMessages(ctx, data.messages, "history");

  // on-demand pages answer `wa backfill`; they say nothing about the initial sync
  if (data.syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) return;
  const progress: HistoryProgress = {
    syncType: data.syncType ?? null,
    progress: data.progress ?? null,
    isLatest: Boolean(data.isLatest),
    chunkOrder: data.chunkOrder ?? null,
    at: nowSeconds(),
  };
  ctx.store.sync.set(HISTORY_PROGRESS_KEY, progress);
}

/** `isLatest` does not mean done; this event does. */
export function recordHistoryStatus(
  ctx: IngestContext,
  status: BaileysEventMap["messaging-history.status"],
): void {
  const value: HistoryStatus = { ...status, at: nowSeconds() };
  ctx.store.sync.set(HISTORY_STATUS_KEY, value);
}
