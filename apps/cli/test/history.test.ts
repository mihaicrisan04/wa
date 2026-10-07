import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createLogger, startEngine, type Engine } from "@wa/engine";
import {
  buildMessage,
  content,
  FakeWhatsAppClient,
  historySet,
  HistorySyncType,
  makeTempHome,
  phoneArchive,
  type TempHome,
} from "@wa/engine/testing";
import { runCli } from "../src/cli";

const ME = { id: "40700000001:7@s.whatsapp.net", lid: "100000000000001:7@lid" };
const ANA = "40700000002@s.whatsapp.net";
const NEWEST = 1_700_000_000;

let temp: TempHome;
let engine: Engine;
let client: FakeWhatsAppClient;
let env: Record<string, string>;

beforeEach(async () => {
  temp = await makeTempHome();
  env = { WA_HOME: temp.home };
  engine = await startEngine(temp.config, {
    client: () => (client = new FakeWhatsAppClient(client?.user as never)),
    logger: createLogger("silent"),
    backfillTimeoutMs: 100,
  });
});

afterEach(async () => {
  await engine.stop();
  await temp.cleanup();
});

async function run(argv: string[], historyIdleMs = 5_000) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env,
    pollMs: 5,
    historyIdleMs,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** Pairs and opens the fake socket once `wa link` is waiting for the scan. */
async function scanQr() {
  while (engine.connection.status().state !== "linking") await Bun.sleep(2);
  client.pair(ME);
  await client.idle();
  client.open();
  await client.idle();
}

async function emit(events: Parameters<FakeWhatsAppClient["emitBatch"]>[0]) {
  client.emitBatch(events);
  await client.idle();
  await engine.ingest.drain();
}

/** Waits until `wa link` has printed `text`. */
async function printed(lines: () => string, text: string) {
  while (!lines().includes(text)) await Bun.sleep(2);
}

describe("wa link", () => {
  test("follows the history sync until WhatsApp says it is done", async () => {
    const out: string[] = [];
    const linking = runCli(["link"], {
      out: (line) => out.push(line),
      err: (line) => out.push(line),
      env,
      pollMs: 5,
      historyIdleMs: 5_000,
    });
    await scanQr();
    await printed(() => out.join("\n"), "history: waiting for the phone");

    await emit({
      "messaging-history.status": {
        syncType: HistorySyncType.INITIAL_BOOTSTRAP,
        status: "complete",
        explicit: true,
      },
    });
    await emit({
      "messaging-history.set": historySet({
        syncType: HistorySyncType.RECENT,
        progress: 40,
        messages: [buildMessage({ chat: ANA, ts: NEWEST })],
      }),
    });
    await printed(() => out.join("\n"), "history: in progress (40%), 1 message stored");
    await emit({
      "messaging-history.status": {
        syncType: HistorySyncType.RECENT,
        status: "complete",
        explicit: true,
      },
    });

    expect(await linking).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("linked as +40700000001");
    expect(text).toContain("history sync complete: 1 chat, 1 message stored");

    const status = await run(["status"]);
    expect(status.out).toMatch(/history\s+complete/);
    expect(status.out).toMatch(/sync phases\s+initial_bootstrap complete · recent complete/);
  });

  test("stops watching when the sync goes quiet, and when the connection drops", async () => {
    const quiet = run(["link"], 30);
    await scanQr();
    const result = await quiet;
    expect(result.code).toBe(0);
    expect(result.out).toContain("no news from the history sync for a while");

    const relinking = run(["link", "--relink"]);
    await scanQr();
    await Bun.sleep(20);
    client.close(401);
    await client.idle();
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
    await emit({
      "contacts.upsert": [{ id: ANA, name: "Ana" }],
      "messages.upsert": {
        type: "notify",
        messages: [buildMessage({ chat: ANA, ts: NEWEST, message: content.text("hi") })],
      },
    });
  });

  test("pages back and reports how far it got", async () => {
    client.answerHistory = phoneArchive(
      Array.from({ length: 70 }, (_, i) => buildMessage({ chat: ANA, ts: NEWEST - 60 * (i + 1) })),
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

    await emit({ "chats.upsert": [{ id: "120363000000000009@g.us", name: "Empty group" }] });
    const empty = await run(["backfill", "Empty group"]);
    expect(empty.code).toBe(1);
    expect(empty.err).toContain("nothing stored in this chat yet");

    const unknown = await run(["backfill", "Nobody"]);
    expect(unknown).toMatchObject({ code: 1, err: "wa backfill: chat not found" });
  });
});
