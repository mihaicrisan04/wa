import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Status } from "@wa/sdk";
import { HISTORY_STALL_SECONDS, readHistorySync } from "../src/queries/history";
import { openStore, type HistoryPhaseState, type HistoryPhases, type Store } from "../src/store";
import { historySet, HistorySyncType, json, startApi } from "../src/testing";
import { connectMcp } from "./support/mcp";

const NOW = 1_700_000_000;
const FRESH = NOW - 5;
const STALE = NOW - HISTORY_STALL_SECONDS;

let store: Store;

beforeEach(() => {
  store = openStore(":memory:");
});
afterEach(() => store.close());

function phase(patch: Partial<HistoryPhaseState>): HistoryPhaseState {
  return { progress: null, status: null, explicit: null, chunks: 1, updatedAt: FRESH, ...patch };
}

function summary(phases: HistoryPhases) {
  store.sync.setHistoryPhases(phases);
  return readHistorySync(store, NOW);
}

describe("overall history sync", () => {
  test("nothing yet", () => {
    expect(readHistorySync(store, NOW)).toEqual({
      progress: null,
      status: null,
      updatedAt: null,
      phases: [],
    });
  });

  test("a finished bootstrap is not a finished sync", () => {
    const bootstrap = phase({ status: "complete", explicit: true, chunks: 0 });
    expect(summary({ initial_bootstrap: bootstrap }).status).toBeNull();
    // nothing after it for a while: WhatsApp stopped sending
    expect(summary({ initial_bootstrap: { ...bootstrap, updatedAt: STALE } }).status).toBe(
      "paused",
    );
  });

  test("recent decides while no full sync was seen, but never finishes the sync", () => {
    const bootstrap = phase({ status: "complete", updatedAt: FRESH - 10 });
    expect(
      summary({ initial_bootstrap: bootstrap, recent: phase({ progress: 40 }) }),
    ).toMatchObject({ progress: 40, status: null });
    // the full sync starts after recent completes
    const recent = phase({ progress: 100, status: "complete", explicit: true });
    expect(summary({ initial_bootstrap: bootstrap, recent })).toMatchObject({
      progress: 100,
      status: null,
    });
    // no full sync after it for a while: WhatsApp stopped sending
    expect(summary({ recent: { ...recent, updatedAt: STALE } })).toMatchObject({
      progress: 100,
      status: "paused",
    });
    expect(summary({ recent: phase({ progress: 70, status: "paused" }) })).toMatchObject({
      progress: 70,
      status: "paused",
    });
  });

  test("the full sync is done at 100%, paused when its chunks stop coming", () => {
    const recent = phase({ progress: 100, status: "complete", updatedAt: FRESH - 30 });
    expect(summary({ recent, full: phase({ progress: 45 }) })).toMatchObject({
      progress: 45,
      status: null,
    });
    expect(summary({ recent, full: phase({ progress: 45, updatedAt: STALE }) })).toMatchObject({
      progress: 45,
      status: "paused",
    });
    expect(summary({ recent, full: phase({ progress: 100 }) })).toMatchObject({
      progress: 100,
      status: "complete",
    });
  });

  test("an explicit status for the full sync wins", () => {
    expect(summary({ full: phase({ progress: 80, status: "complete" }) }).status).toBe("complete");
  });

  test("phases are listed oldest first, with when they last moved", () => {
    const result = summary({
      full: phase({ progress: 10, chunks: 3, updatedAt: FRESH }),
      push_name: phase({ updatedAt: FRESH - 20 }),
      recent: phase({ progress: 100, status: "complete", updatedAt: FRESH - 10 }),
    });
    expect(result.updatedAt).toBe(FRESH);
    expect(result.phases).toEqual([
      { syncType: "push_name", progress: null, status: null, chunks: 1, updatedAt: FRESH - 20 },
      { syncType: "recent", progress: 100, status: "complete", chunks: 1, updatedAt: FRESH - 10 },
      { syncType: "full", progress: 10, status: null, chunks: 3, updatedAt: FRESH },
    ]);
  });
});

describe("surfaced in status", () => {
  test("/v1/status and the MCP status tool show the sync; a new link starts it over", async () => {
    const api = await startApi();
    try {
      await api.emit({
        "messaging-history.status": {
          syncType: HistorySyncType.INITIAL_BOOTSTRAP,
          status: "complete",
          explicit: true,
        },
      });
      await api.emit({
        "messaging-history.set": historySet({ syncType: HistorySyncType.RECENT, progress: 40 }),
      });
      const status = async () => (await (await api.admin("/v1/status")).json()) as Status;
      expect((await status()).history).toMatchObject({
        progress: 40,
        status: null,
        phases: [
          { syncType: "initial_bootstrap", status: "complete", chunks: 0 },
          { syncType: "recent", progress: 40, status: null, chunks: 1 },
        ],
      });

      const token = api.token({ name: "reader", capabilities: ["chats:read"], allChats: true });
      const mcp = await connectMcp(api, token);
      const result = await mcp.call("status");
      await mcp.close();
      expect(result.text).toContain("history sync: in progress (40%)");
      expect(result.text).toContain("history phases: initial_bootstrap complete, recent 40%");
      expect(result.structured).toMatchObject({ history: { progress: 40, phases: [{}, {}] } });

      await api.emit({
        "messaging-history.status": {
          syncType: HistorySyncType.RECENT,
          status: "complete",
          explicit: true,
        },
      });
      expect((await status()).history.status).toBeNull();
      await api.emit({
        "messaging-history.set": historySet({ syncType: HistorySyncType.FULL, progress: 100 }),
      });
      expect((await status()).history.status).toBe("complete");

      expect((await api.admin("/v1/link", json({ relink: true }))).status).toBe(200);
      expect((await status()).history).toEqual({
        progress: null,
        status: null,
        updatedAt: null,
        phases: [],
      });
    } finally {
      await api.stop();
    }
  });
});
