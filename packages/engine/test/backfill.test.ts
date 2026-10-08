import { afterEach, describe, expect, test } from "bun:test";
import type { BackfillJob } from "@wa/sdk";
import { buildMessage, content, phoneArchive } from "../src/testing";
import { eventually, json, startApi, type ApiHarness } from "./support/api";
import { ANA_LID, ANA_PN, BOB_PN, messageRows } from "./support/harness";

const NEWEST = 1_700_000_000;

let api: ApiHarness;

afterEach(() => api.stop());

/** A linked engine holding Ana's newest message; the phone holds `older` more before it. */
async function setup(older: number, { chat = ANA_PN, timeoutMs = 2_000 } = {}) {
  api = await startApi({ engine: { backfillTimeoutMs: timeoutMs } });
  const newest = buildMessage({ chat: ANA_PN, ts: NEWEST, message: content.text("newest") });
  await api.emit({ "messages.upsert": { type: "notify", messages: [newest] } });
  const archive = Array.from({ length: older }, (_, i) =>
    buildMessage({ chat, ts: NEWEST - 60 * (i + 1), message: content.text(`old ${i + 1}`) }),
  );
  return { newest, archive };
}

async function start(body: unknown): Promise<Response> {
  return api.admin("/v1/admin/backfill", json(body));
}

async function finished(response: Response): Promise<BackfillJob> {
  expect(response.status).toBe(202);
  const { id } = (await response.json()) as BackfillJob;
  let job: BackfillJob | null = null;
  await eventually(async () => {
    job = (await (await api.admin(`/v1/admin/backfill/${id}`)).json()) as BackfillJob;
    return job.state === "done";
  }, "the backfill to finish");
  return job!;
}

describe("wa backfill", () => {
  test("pages back from the oldest stored message until WhatsApp has nothing older", async () => {
    const { newest, archive } = await setup(120);
    api.client().answerHistory = phoneArchive(archive);

    const job = await finished(await start({ chat: "+40 700 000 002" }));
    expect(job).toMatchObject({
      chat: ANA_PN,
      state: "done",
      max: 500,
      fetched: 120,
      requests: 4,
      stopReason: "empty",
      oldestAt: NEWEST - 60 * 120,
    });
    expect(messageRows(api.engine.store, ANA_PN)).toHaveLength(121);

    const requests = api.client().historyRequests;
    expect(requests.map((request) => request.count)).toEqual([50, 50, 50, 50]);
    expect(requests[0]).toMatchObject({
      oldestKey: { remoteJid: ANA_PN, id: newest.key.id, fromMe: false },
      oldestTimestamp: NEWEST * 1000,
    });
    // each page continues from the oldest message the previous one stored
    expect(requests[1]).toMatchObject({
      oldestKey: { id: archive[49]!.key.id },
      oldestTimestamp: (NEWEST - 60 * 50) * 1000,
    });
  });

  test("--max caps how many older messages are asked for", async () => {
    const { archive } = await setup(120);
    api.client().answerHistory = phoneArchive(archive);
    const job = await finished(await start({ chat: ANA_PN, max: 60 }));
    expect(job).toMatchObject({ fetched: 60, requests: 2, stopReason: "max" });
    expect(api.client().historyRequests.map((request) => request.count)).toEqual([50, 10]);
  });

  test("a phone that never answers times out", async () => {
    await setup(0, { timeoutMs: 30 });
    const job = await finished(await start({ chat: ANA_PN }));
    expect(job).toMatchObject({ fetched: 0, requests: 1, stopReason: "timeout" });
  });

  test("answers are matched by chat when WhatsApp leaves out the request id", async () => {
    const { archive } = await setup(3, { timeoutMs: 50 });
    const client = api.client();
    client.answerHistory = (request) => {
      const answer = phoneArchive(archive)(request);
      if (answer?.length) setTimeout(() => client.respondToHistory(null, answer), 0);
      return null;
    };
    const job = await finished(await start({ chat: ANA_PN }));
    // an empty answer names no chat, so it can't be told apart from silence
    expect(job).toMatchObject({ fetched: 3, requests: 2, stopReason: "timeout" });
  });

  test("an unrelated answer is not taken for this chat's", async () => {
    await setup(0, { timeoutMs: 50 });
    const client = api.client();
    const other = buildMessage({ chat: BOB_PN, ts: 1_600_000_000 });
    client.answerHistory = () => {
      setTimeout(() => client.respondToHistory("someone-else", [other]), 0);
      return null;
    };
    const job = await finished(await start({ chat: ANA_PN }));
    expect(job.stopReason).toBe("timeout");
  });

  test("falls back to the LID when the phone knows the chat only by it", async () => {
    const { archive } = await setup(70, { chat: ANA_LID });
    await api.emit({ "lid-mapping.update": { lid: ANA_LID, pn: ANA_PN } });
    api.client().answerHistory = phoneArchive(archive);

    const job = await finished(await start({ chat: ANA_PN }));
    expect(job).toMatchObject({ fetched: 70, stopReason: "empty" });
    expect(messageRows(api.engine.store, ANA_PN)).toHaveLength(71);
    expect(api.client().historyRequests.map((request) => request.oldestKey.remoteJid)).toEqual([
      ANA_PN,
      ANA_LID,
      // the LID worked, so it goes first from then on
      ANA_LID,
      ANA_LID,
      ANA_PN,
    ]);
  });

  test("a chat with nothing stored has nothing to page back from", async () => {
    await setup(0);
    await api.emit({ "chats.upsert": [{ id: BOB_PN, name: "Bob" }] });
    const job = await finished(await start({ chat: "Bob" }));
    expect(job).toMatchObject({
      chat: BOB_PN,
      chatName: "Bob",
      requests: 0,
      stopReason: "no_anchor",
    });
  });

  test("a running backfill of the same chat is reused, and it is audited", async () => {
    await setup(0);
    const first = (await (await start({ chat: ANA_PN })).json()) as BackfillJob;
    const second = (await (await start({ chat: ANA_PN, max: 10 })).json()) as BackfillJob;
    expect(second.id).toBe(first.id);
    const audit = api.engine.store.audit.list({ limit: 10 });
    expect(audit.filter((entry) => entry.action === "backfill")).toHaveLength(2);
    expect(audit[0]).toMatchObject({ chat: ANA_PN, detail: { max: 10 } });
  });

  test("stopping the engine ends a waiting backfill", async () => {
    await setup(0);
    const { id } = (await (await start({ chat: ANA_PN })).json()) as BackfillJob;
    await eventually(() => api.client().historyRequests.length === 1, "the request");
    const { backfills } = api.engine;
    await backfills.stop();
    expect(backfills.get(id)).toMatchObject({ state: "done", stopReason: "stopped" });
  });

  test("a disconnect between pages ends it", async () => {
    const { archive } = await setup(120);
    const client = api.client();
    client.answerHistory = phoneArchive(archive);
    api.engine.ingest.onHistoryPage(() => client.close(428));
    const job = await finished(await start({ chat: ANA_PN }));
    expect(job).toMatchObject({ fetched: 50, requests: 1, stopReason: "disconnected" });
  });

  test("bad requests", async () => {
    await setup(0);
    expect((await start({ chat: "Nobody" })).status).toBe(404);
    expect((await start({ chat: ANA_PN, max: 0 })).status).toBe(400);
    expect((await api.admin("/v1/admin/backfill/b_missing")).status).toBe(404);

    api.client().close(428);
    await api.client().idle();
    const offline = await start({ chat: ANA_PN });
    expect(offline.status).toBe(503);
    expect(await offline.json()).toMatchObject({ error: { code: "offline" } });
  });

  test("only the admin socket can backfill", async () => {
    await setup(0);
    const token = api.token({ name: "everything", capabilities: ["send", "link"], allChats: true });
    const response = await api.http("/v1/admin/backfill", token, json({ chat: ANA_PN }));
    expect(response.status).toBe(404);
  });
});
