import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { proto } from "@whiskeysockets/baileys";
import { buildMessage, content, keyOf } from "../src/testing";
import {
  ANA_PN,
  BOB_PN,
  GROUP,
  ME_PN,
  count,
  harness,
  messageRows,
  type Harness,
} from "./support/harness";

let h: Harness;

beforeEach(() => {
  h = harness();
});
afterEach(() => h.close());

const upsert = (...messages: ReturnType<typeof buildMessage>[]) =>
  h.emit({ "messages.upsert": { messages, type: "notify" } });

describe("messages.upsert", () => {
  test("stores messages with Long timestamps and creates the chat", async () => {
    const message = buildMessage({
      chat: ANA_PN,
      ts: 1_700_000_123,
      pushName: "Ana",
      message: content.text("salut"),
    });
    await upsert(message);

    expect(messageRows(h.store, ANA_PN)).toEqual([
      expect.objectContaining({
        id: message.key.id,
        ts: 1_700_000_123,
        text: "salut",
        sender_jid: ANA_PN,
      }),
    ]);
    expect(h.store.chats.get(ANA_PN)).toMatchObject({ kind: "dm", last_message_at: 1_700_000_123 });
    expect(h.store.contacts.get(ANA_PN)).toMatchObject({ push_name: "Ana" });
  });

  test("the sent echo is deduplicated on (chat, id)", async () => {
    const sent = await h.client.sendMessage(ANA_PN, { text: "hey" }, { messageId: "3EB0SENT" });
    await h.client.idle();
    await upsert(sent!);
    expect(messageRows(h.store, ANA_PN)).toEqual([
      expect.objectContaining({ id: "3EB0SENT", text: "hey", sender_jid: ME_PN }),
    ]);
  });

  test("a placeholder is replaced once the content decrypts", async () => {
    const stub = buildMessage({
      chat: ANA_PN,
      id: "3EB0RETRY",
      message: null,
      stubType: proto.WebMessageInfo.StubType.CIPHERTEXT,
    });
    await upsert(stub);
    expect(messageRows(h.store, ANA_PN)).toEqual([
      expect.objectContaining({ type: "placeholder", text: null }),
    ]);

    await upsert(
      buildMessage({ chat: ANA_PN, id: "3EB0RETRY", message: content.text("decrypted") }),
    );
    expect(messageRows(h.store, ANA_PN)).toEqual([
      expect.objectContaining({ type: "text", text: "decrypted" }),
    ]);
    expect(h.store.search("decrypted")).toHaveLength(1);
  });

  test("carriers and status broadcasts never become rows", async () => {
    const target = buildMessage({ chat: ANA_PN, message: content.text("hi") });
    await upsert(
      target,
      buildMessage({ chat: ANA_PN, message: content.reaction(keyOf(target), "👍") }),
      buildMessage({
        chat: "status@broadcast",
        participant: ANA_PN,
        message: content.text("story"),
      }),
    );
    expect(count(h.store, "SELECT * FROM messages")).toBe(1);
    expect(h.store.chats.get("status@broadcast")).toBeNull();
  });

  test("view-once media is stored without raw and flagged", async () => {
    await upsert(
      buildMessage({ chat: ANA_PN, id: "3EB0ONCE", message: content.viewOnce(content.image()) }),
    );
    expect(h.store.messages.get(ANA_PN, "3EB0ONCE")).toMatchObject({
      view_once: 1,
      raw: null,
      has_media: 1,
    });
  });

  test("media metadata is recorded", async () => {
    await upsert(
      buildMessage({
        chat: ANA_PN,
        id: "3EB0DOC",
        message: content.document({ fileName: "curs.pdf" }),
      }),
    );
    expect(h.store.media.get({ chatJid: ANA_PN, id: "3EB0DOC" })).toMatchObject({
      kind: "document",
      mimetype: "application/pdf",
      file_name: "curs.pdf",
      size: 1024,
      local_path: null,
    });
  });

  test("own chat is kind self", async () => {
    await upsert(
      buildMessage({ chat: ME_PN, fromMe: true, message: content.text("note to self") }),
    );
    expect(h.store.chats.get(ME_PN)?.kind).toBe("self");
  });
});

describe("deletes", () => {
  test("delete-for-me removes the row, its search entry and its media", async () => {
    const message = buildMessage({
      chat: ANA_PN,
      id: "3EB0DEL",
      message: content.document({ caption: "notițe" }),
    });
    await upsert(message, buildMessage({ chat: ANA_PN, id: "3EB0KEEP" }));
    await h.emit({ "messages.delete": { keys: [keyOf(message)] } });

    expect(messageRows(h.store, ANA_PN).map((row) => row.id)).toEqual(["3EB0KEEP"]);
    expect(h.store.search("notite")).toEqual([]);
    expect(h.store.media.get({ chatJid: ANA_PN, id: "3EB0DEL" })).toBeNull();
  });

  test("clearing a chat removes all its messages but keeps the chat", async () => {
    await upsert(
      buildMessage({ chat: ANA_PN }),
      buildMessage({ chat: ANA_PN }),
      buildMessage({ chat: BOB_PN }),
    );
    // Baileys' buffer drops the `all` form, so it only ever arrives unbuffered
    h.client.emit("messages.delete", { jid: ANA_PN, all: true });
    await h.client.idle();
    expect(messageRows(h.store, ANA_PN)).toEqual([]);
    expect(messageRows(h.store, BOB_PN)).toHaveLength(1);
    expect(h.store.chats.get(ANA_PN)).not.toBeNull();
  });

  test("deleting a chat removes it with its messages and participants", async () => {
    await h.emit({
      "groups.upsert": [
        { id: GROUP, subject: "PP", owner: undefined, participants: [{ id: ANA_PN }] },
      ],
    });
    await upsert(buildMessage({ chat: GROUP, participant: ANA_PN, message: content.text("bye") }));
    await h.emit({ "chats.delete": [GROUP] });
    expect(h.store.chats.get(GROUP)).toBeNull();
    expect(messageRows(h.store, GROUP)).toEqual([]);
    expect(h.store.participants.list(GROUP)).toEqual([]);
    expect(h.store.search("bye")).toEqual([]);
  });
});

describe("disappearing messages", () => {
  test("expired ones are purged", async () => {
    const now = Math.floor(Date.now() / 1000);
    await upsert(
      buildMessage({
        chat: ANA_PN,
        id: "3EB0POOF",
        ts: now - 100,
        message: content.extendedText("poof", { expiration: 60 }),
      }),
      buildMessage({
        chat: ANA_PN,
        id: "3EB0STAY",
        ts: now - 100,
        message: content.extendedText("stay", { expiration: 86_400 }),
      }),
    );
    h.store.purgeExpired(now);
    expect(messageRows(h.store, ANA_PN).map((row) => row.id)).toEqual(["3EB0STAY"]);
  });
});

describe("robustness", () => {
  test("one bad message does not lose the rest of the batch", async () => {
    const broken = buildMessage({ chat: ANA_PN, message: content.text("broken") });
    Object.defineProperty(broken, "messageTimestamp", {
      get() {
        throw new Error("corrupt");
      },
    });
    await upsert(
      broken,
      buildMessage({ chat: ANA_PN, id: "3EB0FINE", message: content.text("fine") }),
    );
    expect(messageRows(h.store, ANA_PN).map((row) => row.id)).toEqual(["3EB0FINE"]);
  });

  test("a write that fails is rolled back alone, the rest of the batch is kept", async () => {
    const upsertRow = h.store.messages.upsert.bind(h.store.messages);
    h.store.messages.upsert = (record) => {
      const applied = upsertRow(record);
      if (record.id === "3EB0FAIL") throw new Error("disk hiccup");
      return applied;
    };
    await upsert(
      buildMessage({ chat: ANA_PN, id: "3EB0FAIL", message: content.text("half written") }),
      buildMessage({ chat: ANA_PN, id: "3EB0OK", message: content.text("whole") }),
    );
    expect(messageRows(h.store, ANA_PN).map((row) => row.id)).toEqual(["3EB0OK"]);
    expect(h.store.search("half")).toEqual([]);
  });
});
