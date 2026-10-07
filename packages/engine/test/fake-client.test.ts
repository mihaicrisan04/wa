import { describe, expect, test } from "bun:test";
import type { BaileysEventMap } from "@whiskeysockets/baileys";
import { Jimp, JimpMime } from "jimp";
import {
  ANA_PN,
  buildMessage,
  content,
  FakeWhatsAppClient,
  HistorySyncType,
  keyOf,
  ME,
} from "../src/testing";
import { buildOutgoingContent } from "../src/whatsapp/outgoing";

function collect(client: FakeWhatsAppClient) {
  const batches: Partial<BaileysEventMap>[] = [];
  client.ev.process(async (events) => {
    batches.push(events);
  });
  return batches;
}

describe("FakeWhatsAppClient events", () => {
  test("delivers buffered events as one consolidated ev.process batch", async () => {
    const client = new FakeWhatsAppClient(ME);
    const batches = collect(client);
    const first = buildMessage({
      chat: ANA_PN,
      message: content.text("one"),
    });
    const second = buildMessage({
      chat: ANA_PN,
      message: content.text("two"),
    });

    client.emitBatch({
      "chats.upsert": [{ id: ANA_PN, name: "Ana" }],
      "messages.upsert": { messages: [first, second], type: "notify" },
    });
    await client.idle();

    expect(batches).toHaveLength(1);
    expect(Object.keys(batches[0]!).sort()).toEqual(["chats.upsert", "messages.upsert"]);
    expect(batches[0]!["messages.upsert"]!.messages.map((m) => m.key.id)).toEqual([
      first.key.id,
      second.key.id,
    ]);
  });

  test("idle waits for slow handlers", async () => {
    const client = new FakeWhatsAppClient();
    let done = false;
    client.ev.process(async () => {
      await Bun.sleep(10);
      done = true;
    });
    client.emit("contacts.upsert", [{ id: ANA_PN }]);
    await client.idle();
    expect(done).toBe(true);
  });
});

describe("FakeWhatsAppClient.sendMessage", () => {
  test("uses the given message id and echoes the upsert like Baileys", async () => {
    const client = new FakeWhatsAppClient(ME);
    const batches = collect(client);

    const sent = await client.sendMessage(ANA_PN, { text: "hey" }, { messageId: "3EB0FIXED" });
    await client.idle();

    expect(sent?.key).toMatchObject({
      id: "3EB0FIXED",
      fromMe: true,
      remoteJid: ANA_PN,
    });
    expect(client.sent).toHaveLength(1);
    expect(batches[0]!["messages.upsert"]).toMatchObject({
      type: "append",
      messages: [{ key: { id: "3EB0FIXED" } }],
    });
  });

  test("builds media messages through Baileys with a stub upload", async () => {
    const client = new FakeWhatsAppClient(ME);
    const png = await new Jimp({ width: 40, height: 30, color: 0x00ff00ff }).getBuffer(
      JimpMime.png,
    );
    const outgoing = await buildOutgoingContent({
      kind: "file",
      bytes: png,
      fileName: "a.png",
      mimetype: null,
      caption: "pic",
    });

    const sent = await client.sendMessage(ANA_PN, outgoing);
    expect(sent?.message?.imageMessage).toMatchObject({
      mimetype: "image/jpeg",
      caption: "pic",
      width: 40,
      height: 30,
    });
    expect(sent?.message?.imageMessage?.jpegThumbnail?.length).toBeGreaterThan(0);
  });

  test("can simulate send failures", async () => {
    const client = new FakeWhatsAppClient(ME);
    client.sendFailure = new Error("offline");
    await expect(client.sendMessage(ANA_PN, { text: "x" })).rejects.toThrow("offline");
  });
});

describe("FakeWhatsAppClient history and media", () => {
  test("history requests resolve with an id and are answered later as ON_DEMAND", async () => {
    const client = new FakeWhatsAppClient(ME);
    const batches = collect(client);
    const oldest = buildMessage({ chat: ANA_PN, ts: 1_700_000_000 });

    const requestId = await client.fetchMessageHistory(50, keyOf(oldest), 1_700_000_000_000);
    expect(client.historyRequests).toEqual([
      { requestId, count: 50, oldestKey: keyOf(oldest), oldestTimestamp: 1_700_000_000_000 },
    ]);
    expect(batches).toHaveLength(0);

    const older = buildMessage({ chat: ANA_PN, ts: 1_699_999_000 });
    client.respondToHistory(requestId, [older]);
    await client.idle();
    expect(batches[0]!["messaging-history.set"]).toMatchObject({
      syncType: HistorySyncType.ON_DEMAND,
      peerDataRequestSessionId: requestId,
      messages: [{ key: { id: older.key.id } }],
    });
  });

  test("media reupload returns an updated message", async () => {
    const client = new FakeWhatsAppClient(ME);
    const message = buildMessage({ chat: ANA_PN, message: content.image() });
    const updated = await client.updateMediaMessage(message);
    expect(client.mediaReuploads).toEqual([message]);
    expect(updated.message?.imageMessage?.directPath).toBe("/v/t62.fixture-refreshed");
  });

  test("resolves LIDs through the signal repository", async () => {
    const client = new FakeWhatsAppClient(ME);
    await client.lidMapping.storeLIDPNMappings([
      { lid: "111@lid", pn: "40700000005@s.whatsapp.net" },
    ]);
    expect(await client.signalRepository.lidMapping.getPNForLID("111@lid")).toBe(
      "40700000005:0@s.whatsapp.net",
    );
    expect(await client.signalRepository.lidMapping.getPNsForLIDs(["222@lid"])).toBeNull();
  });
});
