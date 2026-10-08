import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { createWaClient, MAX_UPLOAD_BYTES, WaApiError, type WaClient } from "@wa/sdk";
import { raycastTokenPath } from "../src/config";
import { startApi, type ApiHarness } from "./support/api";
import { ME_PN } from "./support/jids";
import { MASTER, MASTER_IMAGE_ID, MASTER_TEXT_ID, worldEvents } from "./support/world";

let api: ApiHarness;
let wa: WaClient;
let admin: WaClient;

beforeAll(async () => {
  api = await startApi({
    engine: { mediaDownload: (async () => Readable.from([Buffer.from("jpeg")])) as never },
  });
  await api.emit(worldEvents());
  const token = (await readFile(raycastTokenPath(api.temp.home), "utf8")).trim();
  wa = createWaClient({ baseUrl: `http://127.0.0.1:${api.engine.port}`, token });
  admin = createWaClient({
    baseUrl: "http://localhost",
    fetch: (input, init) => fetch(input, { ...init, unix: api.engine.socketPath }),
  });
});

afterAll(() => api.stop());

describe("@wa/sdk against a live engine", () => {
  test("status, qr and link", async () => {
    expect(await wa.status()).toMatchObject({ state: "open", me: { jid: ME_PN } });
    expect(await wa.qr()).toEqual({ state: "open", qr: null });
    const error = await wa.link().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WaApiError);
    expect(error).toMatchObject({ status: 409, code: "already_linked" });
  });

  test("chats, messages, search and media", async () => {
    expect((await wa.chats({ kind: "group" })).items.map((chat) => chat.jid)).toContain(MASTER);
    expect((await wa.chat("Master PP")).participants).toHaveLength(2);
    const page = await wa.messages(MASTER, { limit: 1, around: MASTER_TEXT_ID });
    expect(page.messages.map((message) => message.id)).toEqual([MASTER_TEXT_ID]);
    expect((await wa.message(MASTER, MASTER_TEXT_ID, { context: 1 })).after).toHaveLength(1);
    expect((await wa.search({ q: "sarcina" })).items[0]?.message.id).toBe(MASTER_TEXT_ID);
    expect(await wa.media(MASTER, MASTER_IMAGE_ID)).toMatchObject({ kind: "image" });
    const download = await wa.downloadMedia(MASTER, MASTER_IMAGE_ID);
    expect(download.mimetype).toBe("image/jpeg");
    expect(new TextDecoder().decode(await download.response.arrayBuffer())).toBe("jpeg");
  });

  test("ambiguity comes back with candidates", async () => {
    const error = (await wa.chat("p").catch((err: unknown) => err)) as WaApiError;
    expect(error.code).toBe("ambiguous");
    expect(error.candidates.map((candidate) => candidate.jid)).toContain(MASTER);
  });

  test("recipients, send, sendFile and outbox", async () => {
    expect((await wa.recipients({ q: "master" })).map((recipient) => recipient.jid)).toContain(
      MASTER,
    );
    const text = await wa.send({ to: "self", text: "hi" });
    const file = await wa.sendFile({
      to: "self",
      file: new Blob(["hello"], { type: "text/plain" }),
      fileName: "hello.txt",
      caption: "a file",
    });
    await api.engine.outbox.idle();
    expect((await wa.outbox(text.outboxId)).status).toBe("sent");
    expect((await wa.outbox(file.outboxId)).status).toBe("sent");
    expect(api.client().sent.at(-1)?.content).toMatchObject({ fileName: "hello.txt" });
  });

  test("a file bigger than Bun's 128 MB default body limit still uploads", async () => {
    const size = 129 * 1024 * 1024;
    const result = await wa.sendFile({
      to: "self",
      file: new Blob([new Uint8Array(size)]),
      fileName: "big.bin",
    });
    expect(result.status).toBe("queued");
    await api.engine.outbox.idle();
  });

  test("files over WhatsApp's 2 GB cap are refused before uploading", async () => {
    const huge = { size: MAX_UPLOAD_BYTES + 1 } as Blob;
    const error = await wa
      .sendFile({ to: "self", file: huge, fileName: "huge.bin" })
      .catch((err: unknown) => err);
    expect(error).toMatchObject({ status: 413, code: "too_large" });
  });

  test("admin over the socket", async () => {
    const created = await admin.admin.collections.create({ name: "sdk", description: "x" });
    expect(created.chats).toEqual([]);
    expect((await admin.admin.collections.addChats("sdk", [MASTER])).chatCount).toBe(1);
    expect((await admin.admin.collections.removeChat("sdk", MASTER)).chatCount).toBe(0);
    expect((await admin.admin.collections.list()).map((c) => c.name)).toContain("sdk");
    expect((await admin.admin.collections.get("sdk")).description).toBe("x");

    await admin.admin.profiles.create({
      name: "sdk",
      capabilities: ["chats:read"],
      collections: ["sdk"],
    });
    expect((await admin.admin.profiles.list()).map((p) => p.name)).toContain("sdk");
    const token = await admin.admin.tokens.create({ profile: "sdk", label: "test" });
    expect((await admin.admin.tokens.list("sdk")).map((t) => t.id)).toEqual([token.id]);
    expect((await admin.admin.tokens.revoke(token.id)).revokedAt).toBeNumber();
    expect((await admin.admin.audit({ limit: 3 })).items[0]?.action).toBe("token.revoke");

    await admin.admin.profiles.delete("sdk");
    await admin.admin.collections.delete("sdk");
    const missing = await admin.admin.collections.get("sdk").catch((err: unknown) => err);
    expect(missing).toMatchObject({ status: 404 });
  });
});

test("an error body that isn't the engine's shape becomes http_error", async () => {
  const respond = (body: string) => async () => new Response(body, { status: 502 });
  for (const body of ["<html>bad gateway</html>", JSON.stringify({ error: { code: 7 } })]) {
    const error = await createWaClient({ fetch: respond(body) })
      .status()
      .catch((err) => err);
    expect(error).toMatchObject({ status: 502, code: "http_error", candidates: [] });
  }
});
