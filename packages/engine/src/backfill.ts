import { randomBytes } from "node:crypto";
import type { BackfillJob, BackfillStopReason } from "@wa/sdk";
import type { HistoryPage, Ingest } from "./ingest";
import type { Logger } from "./logger";
import { nowSeconds, type OldestMessage, type Store } from "./store";
import type { WhatsAppClient } from "./whatsapp/client";

/** The most messages WhatsApp hands out per on-demand request. */
export const BACKFILL_PAGE_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 45_000;
/** Finished runs stay around this many at a time, for `wa backfill` to read the outcome. */
const FINISHED_KEPT = 20;

export interface BackfillOptions {
  store: Store;
  ingest: Ingest;
  logger: Logger;
  /** The socket while connected, null otherwise. */
  client: () => WhatsAppClient | null;
  /** How long to wait for the phone to answer one request. */
  timeoutMs?: number;
}

interface Run {
  job: BackfillJob;
  abort: AbortController;
  done: Promise<void>;
}

type Answer = "answered" | "timeout" | "disconnected" | "stopped";

/**
 * `fetchMessageHistory` only sends the request; the phone answers later with an ON_DEMAND
 * history set, which ingest stores like any other. A run requests a page older than the
 * chat's oldest stored message, waits for that answer, and repeats from the new oldest.
 */
export class Backfills {
  private readonly runs = new Map<string, Run>();

  constructor(private readonly options: BackfillOptions) {}

  /** Starts paging back through a canonical chat; a chat already being backfilled keeps its run. */
  start(chat: string, chatName: string | null, max: number): BackfillJob {
    const running = [...this.runs.values()].find(
      ({ job }) => job.chat === chat && job.state === "running",
    );
    if (running) return { ...running.job };

    const job: BackfillJob = {
      id: `b_${randomBytes(6).toString("hex")}`,
      chat,
      chatName,
      state: "running",
      max,
      fetched: 0,
      requests: 0,
      oldestAt: this.options.store.messages.oldest(chat)?.ts ?? null,
      stopReason: null,
      startedAt: nowSeconds(),
      finishedAt: null,
    };
    const abort = new AbortController();
    const done = this.page(job, abort.signal)
      .catch((err: unknown): BackfillStopReason => {
        this.options.logger.error({ err, chat }, "backfill failed");
        return "failed";
      })
      .then((reason) => {
        Object.assign(job, { state: "done", stopReason: reason, finishedAt: nowSeconds() });
        this.options.logger.info(
          { chat, fetched: job.fetched, requests: job.requests, reason },
          "backfill finished",
        );
      });
    this.runs.set(job.id, { job, abort, done });
    this.forgetOldRuns();
    return { ...job };
  }

  get(id: string): BackfillJob | null {
    const run = this.runs.get(id);
    return run ? { ...run.job } : null;
  }

  async stop(): Promise<void> {
    for (const run of this.runs.values()) run.abort.abort();
    await Promise.all([...this.runs.values()].map((run) => run.done));
  }

  private async page(job: BackfillJob, signal: AbortSignal): Promise<BackfillStopReason> {
    const { store } = this.options;
    let remoteJids = this.remoteJidsOf(job.chat);
    while (job.fetched < job.max) {
      const anchor = store.messages.oldest(job.chat);
      if (!anchor) return "no_anchor";
      const before = store.messages.countUntil(job.chat, anchor.ts);
      const count = Math.min(BACKFILL_PAGE_SIZE, job.max - job.fetched);

      let fetched = 0;
      let answered = false;
      // the phone may know a chat only by its LID; try it when the canonical jid gets nothing
      for (const remoteJid of remoteJids) {
        const answer = await this.request(job, remoteJid, anchor, count, signal);
        if (answer === "disconnected" || answer === "stopped") return answer;
        answered ||= answer === "answered";
        fetched = store.messages.countUntil(job.chat, anchor.ts) - before;
        if (fetched > 0) {
          remoteJids = [remoteJid, ...remoteJids.filter((jid) => jid !== remoteJid)];
          break;
        }
      }
      if (fetched <= 0) return answered ? "empty" : "timeout";
      job.fetched += fetched;
      job.oldestAt = store.messages.oldest(job.chat)?.ts ?? job.oldestAt;
    }
    return "max";
  }

  private async request(
    job: BackfillJob,
    remoteJid: string,
    anchor: OldestMessage,
    count: number,
    signal: AbortSignal,
  ): Promise<Answer> {
    if (signal.aborted) return "stopped";
    const client = this.options.client();
    if (!client) return "disconnected";
    // listening before asking, so an answer that beats the request's promise is not missed
    const pages = new PageWatch(this.options.ingest);
    try {
      job.requests++;
      const key = { remoteJid, id: anchor.id, fromMe: anchor.from_me === 1 };
      const requestId = await client.fetchMessageHistory(count, key, anchor.ts * 1000);
      const page = await pages.next(
        (candidate) => candidate.sessionId === requestId || candidate.chats.has(job.chat),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal,
      );
      if (page) return "answered";
      return signal.aborted ? "stopped" : "timeout";
    } catch (err) {
      if (!this.options.client()) return "disconnected";
      throw err;
    } finally {
      pages.close();
    }
  }

  private remoteJidsOf(chat: string): string[] {
    const lid = this.options.store.identity.lidForPn(chat);
    return lid ? [chat, lid] : [chat];
  }

  private forgetOldRuns(): void {
    const finished = [...this.runs.values()].filter(({ job }) => job.state === "done");
    for (const { job } of finished.slice(0, Math.max(0, finished.length - FINISHED_KEPT))) {
      this.runs.delete(job.id);
    }
  }
}

/** Collects stored on-demand pages from the moment it is created. */
class PageWatch {
  private readonly pages: HistoryPage[] = [];
  private wake: (() => void) | null = null;
  private readonly unsubscribe: () => void;

  constructor(ingest: Ingest) {
    this.unsubscribe = ingest.onHistoryPage((page) => {
      this.pages.push(page);
      this.wake?.();
    });
  }

  /** The first page that matches, or null once the time is up or the signal aborts. */
  async next(
    matches: (page: HistoryPage) => boolean,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<HistoryPage | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const page = this.pages.find(matches);
      if (page) return page;
      const left = deadline - Date.now();
      if (left <= 0 || signal.aborted) return null;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          this.wake = null;
          resolve();
        };
        const timer = setTimeout(done, left);
        signal.addEventListener("abort", done);
        this.wake = done;
      });
    }
  }

  close(): void {
    this.unsubscribe();
    this.wake?.();
  }
}
