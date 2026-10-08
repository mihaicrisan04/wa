import { afterEach, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import type { OutboxEntry, Recipient, SendResult } from "@wa/sdk";
import { startEngine } from "../src/engine";
import { FakeWhatsAppClient } from "../src/testing";
import { eventually, json, startApi, type ApiHarness } from "./support/api";
import { silent } from "./support/harness";
import { ME, ME_PN } from "./support/jids";
import { MASTER, SECRET, worldEvents } from "./support/world";

let api: ApiHarness;

afterEach(() => api.stop());

const SELF_ONLY = { name: "self", capabilities: ["send:self" as const], allChats: false };
const SCOPED_SENDER = {
  name: "master-send",
  capabilities: ["send" as const, "chats:read" as const],
  collections: ["master"],
};

async function send(token: string, body: unknown): Promise<Response> {
  return api.http("/v1/send", token, json(body));
}

async function sent(response: Response): Promise<SendResult> {
  expect(response.status).toBe(202);
  return (await response.json()) as SendResult;
}

function entry(id: string) {
  return api.engine.store.outbox.get(id)!;
}

describe("send:self", () => {
  test("before linking, self is a 409", async () => {
    api = await startApi({ linked: false });
    const response = await send(api.token(SELF_ONLY), { to: "self", text: "hi" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "not_linked" } });
  });

  test("queues while offline after linking, then goes out on connect", async () => {
    api = await startApi({ open: false });
    const result = await sent(await send(api.token(SELF_ONLY), { to: "self", text: "note" }));
    expect(result.status).toBe("queued");
    await api.engine.outbox.idle();
    expect(api.client().sent).toEqual([]);

    api.client().open(ME);
    await eventually(() => entry(result.outboxId).status === "sent", "the send");
    expect(api.client().sent[0]).toMatchObject({ jid: ME_PN, content: { text: "note" } });
    await api.engine.ingest.drain();
    await eventually(
      () => api.engine.store.messages.get(ME_PN, result.messageId)?.text === "note",
      "the echo to be stored under the fixed id",
    );
  });

  test("reaches only the own chat", async () => {
    api = await startApi();
    const token = api.token(SELF_ONLY);
    await sent(await send(token, { to: ME_PN, text: "exact own jid" }));
    for (const to of [MASTER, "40700000002@s.whatsapp.net", ME.id, "+40 700 000 001"]) {
      const response = await send(token, { to, text: "nope" });
      expect(`${to} ${response.status}`).toBe(`${to} 403`);
    }
  });

  test("recipients are only the own chat", async () => {
    api = await startApi();
    await api.emit(worldEvents());
    const response = await api.http("/v1/recipients", api.token(SELF_ONLY));
    const { items } = (await response.json()) as { items: Recipient[] };
    expect(items).toEqual([{ jid: ME_PN, name: null, kind: "self", lastMessageAt: null }]);
  });
});

describe("send", () => {
  test("targets must be in scope; out-of-scope ones look missing", async () => {
    api = await startApi();
    await api.emit(worldEvents());
    const token = api.token(SCOPED_SENDER);
    api.engine.store.collections.addChat("master", MASTER);
    await sent(await send(token, { to: "Master PP", text: "by name" }));
    for (const to of [SECRET, "Secret Project", "+40 700 000 003", "self"]) {
      expect((await send(token, { to, text: "nope" })).status).toBe(404);
    }
  });

  test("every send is audited without its text", async () => {
    api = await startApi();
    await api.emit(worldEvents());
    const token = api.token(SCOPED_SENDER);
    api.engine.store.collections.addChat("master", MASTER);
    const result = await sent(await send(token, { to: MASTER, text: "secret text" }));
    const [row] = api.engine.store.audit.list({ profile: "master-send", limit: 5 });
    expect(row).toMatchObject({ action: "send", chat_jid: MASTER });
    expect(JSON.parse(row!.detail!)).toEqual({ outboxId: result.outboxId, kind: "text" });
    expect(JSON.stringify(row)).not.toContain("secret text");
  });

  test("validates the body", async () => {
    api = await startApi();
    const token = api.token(SELF_ONLY);
    expect((await send(token, { to: "self" })).status).toBe(400);
    expect((await send(token, { to: "self", text: "" })).status).toBe(400);
    const raw = await api.http("/v1/send", token, { method: "POST", body: "not json" });
    expect(raw.status).toBe(400);
  });

  test("the outbox entry is readable only by the profile that queued it", async () => {
    api = await startApi();
    const mine = api.token(SELF_ONLY);
    const other = api.token({ ...SELF_ONLY, name: "other" });
    const result = await sent(await send(mine, { to: "self", text: "hi" }));
    const response = await api.http(`/v1/outbox/${result.outboxId}`, mine);
    expect(((await response.json()) as OutboxEntry).chat).toBe(ME_PN);
    expect((await api.http(`/v1/outbox/${result.outboxId}`, other)).status).toBe(404);
    expect((await api.http("/v1/outbox/o_missing", mine)).status).toBe(404);
  });
});

describe("outbox", () => {
  function upload(to: string, name: string, bytes: Uint8Array, type = "") {
    const form = new FormData();
    form.set("to", to);
    form.set("caption", "see attached");
    form.set("file", new File([bytes], name, { type }));
    return api.http("/v1/send", api.token({ ...SELF_ONLY, name: `up-${name}` }), {
      method: "POST",
      body: form,
    });
  }

  test("copies an uploaded file into WA_HOME/outbox and removes it once sent", async () => {
    api = await startApi({ open: false });
    const bytes = new TextEncoder().encode("%PDF-1.4 fixture");
    const result = await sent(
      await upload("self", "../../etc/notes.pdf", bytes, "application/pdf"),
    );
    const row = entry(result.outboxId);
    expect(row.file_path).toBe(`${api.temp.home}/outbox/${result.outboxId}`);
    expect(new Uint8Array(await readFile(row.file_path!))).toEqual(bytes);
    expect(((await stat(row.file_path!)).mode & 0o777).toString(8)).toBe("600");

    api.client().open(ME);
    await eventually(() => entry(result.outboxId).status === "sent", "the upload");
    const content = api.client().sent[0]!.content as { fileName: string; caption: string };
    expect(content).toMatchObject({ fileName: "notes.pdf", caption: "see attached" });
    expect(await stat(row.file_path!).catch(() => null)).toBeNull();
  });

  test("an image that can't be decoded fails instead of retrying", async () => {
    api = await startApi();
    const result = await sent(await upload("self", "broken.png", new Uint8Array([1, 2, 3])));
    await eventually(() => entry(result.outboxId).status === "failed", "the failure");
    expect(api.client().sent).toEqual([]);
  });

  test("retries with the same message id until it goes out", async () => {
    api = await startApi();
    const client = api.client();
    const attempts: (string | undefined)[] = [];
    const original = client.sendMessage;
    client.sendMessage = async (jid, content, options) => {
      attempts.push(options?.messageId);
      return original(jid, content, options);
    };
    client.sendFailure = new Error("socket hiccup");
    const result = await sent(await send(api.token(SELF_ONLY), { to: "self", text: "retry" }));
    await eventually(() => attempts.length >= 2, "two attempts");
    client.sendFailure = null;
    await eventually(() => entry(result.outboxId).status === "sent", "the retry");
    expect(new Set(attempts)).toEqual(new Set([result.messageId]));
    expect(entry(result.outboxId).attempts).toBeGreaterThanOrEqual(3);
  });

  test("an entry that keeps failing is given up on so later ones still go out", async () => {
    api = await startApi();
    await api.emit(worldEvents());
    const client = api.client();
    const original = client.sendMessage;
    client.sendMessage = async (jid, content, options) => {
      if (jid === MASTER) throw new Error("rejected");
      return original(jid, content, options);
    };
    const token = api.token({ name: "everyone", capabilities: ["send"], allChats: true });
    const stuck = await sent(await send(token, { to: MASTER, text: "never" }));
    const later = await sent(await send(token, { to: "self", text: "still goes" }));
    await eventually(() => entry(later.outboxId).status === "sent", "the later entry");
    expect(entry(stuck.outboxId)).toMatchObject({ status: "failed", attempts: 8 });
  });

  test("an entry interrupted mid-send is retried with its id after a restart", async () => {
    api = await startApi({ open: false });
    const result = await sent(await send(api.token(SELF_ONLY), { to: "self", text: "again" }));
    api.engine.store.outbox.markSending(result.outboxId);
    await api.engine.stop();
    const client = new FakeWhatsAppClient(ME);
    api.engine = await startEngine(api.temp.config, { client, logger: silent });
    expect(entry(result.outboxId).status).toBe("queued");
    client.open();
    await eventually(() => entry(result.outboxId).status === "sent", "the resend");
    expect(client.sent[0]?.message.key.id).toBe(result.messageId);
  });

  test("entries past their hour expire instead of going out late", async () => {
    api = await startApi({ open: false });
    const bytes = new TextEncoder().encode("late");
    const result = await sent(await upload("self", "late.txt", bytes));
    api.engine.store.db.run(`UPDATE outbox SET expires_at = 1 WHERE id = '${result.outboxId}'`);
    await api.engine.outbox.expire();
    expect(entry(result.outboxId).status).toBe("expired");
    expect(await stat(entry(result.outboxId).file_path!).catch(() => null)).toBeNull();
    api.client().open(ME);
    await api.engine.outbox.idle();
    expect(api.client().sent).toEqual([]);
  });

  test("goes out in the order it was queued", async () => {
    api = await startApi({ open: false });
    const token = api.token(SELF_ONLY);
    for (const text of ["one", "two", "three"]) await sent(await send(token, { to: "self", text }));
    api.client().open(ME);
    await eventually(() => api.client().sent.length === 3, "all three");
    expect(api.client().sent.map((message) => (message.content as { text: string }).text)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });
});
