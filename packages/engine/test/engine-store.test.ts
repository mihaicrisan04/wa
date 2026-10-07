import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { initAuthCreds } from "@whiskeysockets/baileys";
import {
  ANA_PN,
  buildMessage,
  content,
  eventually,
  GROUP,
  keyOf,
  ME_PN,
  silentLogger,
  startApi,
  type ApiHarness,
  type FakeWhatsAppClient,
} from "../src/testing";
import type { Engine } from "../src/engine";
import type { SocketHooks } from "../src/whatsapp/client";
import { socketConfig } from "../src/whatsapp/socket";

let api: ApiHarness;
let engine: Engine;
let client: FakeWhatsAppClient;
let hooks: SocketHooks;

beforeEach(async () => {
  api = await startApi({ onHooks: (given) => (hooks = given), engine: { purgeIntervalMs: 5 } });
  engine = api.engine;
  client = api.client();
});

afterEach(() => api.stop());

describe("engine wiring", () => {
  test("ingests the socket's events into the store", async () => {
    client.emit("messages.upsert", {
      messages: [buildMessage({ chat: ANA_PN, id: "3EB0LIVE", message: content.text("live") })],
      type: "notify",
    });
    await client.idle();
    expect(engine.store.messages.get({ chatJid: ANA_PN, id: "3EB0LIVE" })?.text).toBe("live");
  });

  test("own messages use the identity from the credentials", async () => {
    client.emit("messages.upsert", {
      messages: [buildMessage({ chat: ME_PN, fromMe: true, message: content.text("note") })],
      type: "notify",
    });
    await client.idle();
    expect(engine.store.chats.get(ME_PN)?.kind).toBe("self");
  });

  test("answers Baileys' getMessage and cachedGroupMetadata from the store", async () => {
    const message = buildMessage({ chat: ANA_PN, message: content.text("retry me") });
    client.groups = { [GROUP]: { id: GROUP, subject: "PP", owner: undefined, participants: [] } };
    client.emit("messages.upsert", { messages: [message], type: "notify" });
    await client.groupFetchAllParticipating();
    await client.idle();

    expect(await hooks.getMessage?.(keyOf(message))).toMatchObject({ conversation: "retry me" });
    expect(await hooks.getMessage?.({ remoteJid: ANA_PN, id: "unknown" })).toBeUndefined();
    expect((await hooks.cachedGroupMetadata?.(GROUP))?.subject).toBe("PP");
  });

  test("purges disappearing messages on a timer", async () => {
    const past = Math.floor(Date.now() / 1000) - 120;
    client.emit("messages.upsert", {
      messages: [
        buildMessage({
          chat: ANA_PN,
          id: "3EB0POOF",
          ts: past,
          message: content.extendedText("poof", { expiration: 60 }),
        }),
      ],
      type: "notify",
    });
    await client.idle();
    await eventually(
      () => engine.store.messages.get({ chatJid: ANA_PN, id: "3EB0POOF" }) === null,
      "the purge",
    );
  });

  test("a purge that fails does not stop the next ones", async () => {
    const purge = spyOn(engine.store, "purgeExpired").mockImplementationOnce(() => {
      throw new Error("disk I/O error");
    });
    await eventually(() => purge.mock.calls.length >= 3, "three purges");
    purge.mockRestore();
  });
});

test("the Baileys socket config wires the hooks and the mandatory options", () => {
  const getMessage = async () => undefined;
  const cachedGroupMetadata = async () => undefined;
  const config = socketConfig({
    version: [2, 3000, 1],
    auth: { creds: initAuthCreds(), keys: { get: async () => ({}), set: async () => undefined } },
    logger: silentLogger,
    hooks: { getMessage, cachedGroupMetadata },
  });
  expect(config).toMatchObject({
    syncFullHistory: true,
    markOnlineOnConnect: false,
    getMessage,
    cachedGroupMetadata,
  });
  expect(config.shouldSyncHistoryMessage?.({} as never)).toBe(true);
});
