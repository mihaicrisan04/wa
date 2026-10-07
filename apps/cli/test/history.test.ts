import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  ANA_PN,
  buildMessage,
  content,
  eventually,
  historySet,
  HistorySyncType,
  ME,
  phoneArchive,
  startApi,
  type ApiHarness,
} from "@wa/engine/testing";
import { run as runWa, type CliRun } from "./support";

const NEWEST = 1_700_000_000;

let api: ApiHarness;

beforeEach(async () => {
  api = await startApi({ linked: false, engine: { backfillTimeoutMs: 100 } });
});

afterEach(() => api.stop());

const run = (argv: string[], historyIdleMs = 5_000) =>
  runWa(argv, { env: { WA_HOME: api.temp.home }, historyIdleMs });

/** Pairs and opens the fake socket once `wa link` is waiting for the scan. */
async function scanQr() {
  await eventually(
    () => api.engine.connection.status().state === "linking",
    "wa link to start pairing",
  );
  api.client().pair(ME);
  await api.client().idle();
  api.client().open();
  await api.client().idle();
}

/** Waits until `wa link` has printed `text`. */
const printed = (linking: CliRun, text: string) =>
  eventually(() => linking.printed().includes(text), `wa link to print "${text}"`);

describe("wa link", () => {
  test("follows the history sync until the full sync is done", async () => {
    const linking = run(["link"]);
    await scanQr();
    await printed(linking, "history: waiting for the phone");

    await api.emit({
      "messaging-history.status": {
        syncType: HistorySyncType.INITIAL_BOOTSTRAP,
        status: "complete",
        explicit: true,
      },
    });
    await api.emit({
      "messaging-history.set": historySet({
        syncType: HistorySyncType.RECENT,
        progress: 40,
        messages: [buildMessage({ chat: ANA_PN, ts: NEWEST })],
      }),
    });
    await printed(linking, "history: in progress (40%), 1 message stored");
    await api.emit({
      "messaging-history.status": {
        syncType: HistorySyncType.RECENT,
        status: "complete",
        explicit: true,
      },
    });
    // the full sync comes after recent
    const statusReads = spyOn(api.engine.connection, "status");
    await eventually(() => statusReads.mock.calls.length >= 2, "wa link to poll the status again");
    statusReads.mockRestore();
    expect(linking.finished()).toBe(false);
    await api.emit({
      "messaging-history.set": historySet({ syncType: HistorySyncType.FULL, progress: 100 }),
    });

    const result = await linking;
    expect(result.code).toBe(0);
    expect(result.out).toContain("linked as +40700000001");
    expect(result.out).toContain("history sync complete: 1 chat, 1 message stored");

    const status = await run(["status"]);
    expect(status.out).toMatch(/history\s+complete/);
    expect(status.out).toMatch(
      /sync phases\s+initial_bootstrap complete · recent complete · full 100%/,
    );
  });

  test("stops watching when the sync goes quiet, and when the connection drops", async () => {
    const quiet = run(["link"], 30);
    await scanQr();
    const result = await quiet;
    expect(result.code).toBe(0);
    expect(result.out).toContain("no news from the history sync for a while");

    const relinking = run(["link", "--relink"]);
    await scanQr();
    await printed(relinking, "syncing history from your phone");
    api.client().close(401);
    await api.client().idle();
    const dropped = await relinking;
    expect(dropped.code).toBe(1);
    expect(dropped.err).toContain("the connection is needs_link, the history sync stopped");
  });
});

describe("wa backfill", () => {
  beforeEach(async () => {
    const linking = run(["link"], 1);
    await scanQr();
    await linking;
    await api.emit({
      "contacts.upsert": [{ id: ANA_PN, name: "Ana" }],
      "messages.upsert": {
        type: "notify",
        messages: [buildMessage({ chat: ANA_PN, ts: NEWEST, message: content.text("hi") })],
      },
    });
  });

  test("pages back and reports how far it got", async () => {
    api.client().answerHistory = phoneArchive(
      Array.from({ length: 70 }, (_, i) =>
        buildMessage({ chat: ANA_PN, ts: NEWEST - 60 * (i + 1) }),
      ),
    );
    const capped = await run(["backfill", "Ana", "--max", "60"]);
    expect(capped.code).toBe(0);
    expect(capped.out).toContain("asking the phone for up to 60 older messages of Ana");
    expect(capped.out).toContain("fetched 60 older messages (the --max of 60)");

    const rest = await run(["backfill", "+40 700 000 002", "--json"]);
    expect(JSON.parse(rest.out)).toMatchObject({ fetched: 10, stopReason: "empty" });
  });

  test("a silent phone and a chat with nothing stored", async () => {
    const silent = await run(["backfill", "Ana"]);
    expect(silent.code).toBe(0);
    expect(silent.out).toContain("fetched 0 older messages; the phone stopped answering");

    await api.emit({ "chats.upsert": [{ id: "120363000000000009@g.us", name: "Empty group" }] });
    const empty = await run(["backfill", "Empty group"]);
    expect(empty.code).toBe(1);
    expect(empty.err).toContain("nothing stored in this chat yet");

    const unknown = await run(["backfill", "Nobody"]);
    expect(unknown).toMatchObject({ code: 1, err: "wa backfill: chat not found" });
  });
});
