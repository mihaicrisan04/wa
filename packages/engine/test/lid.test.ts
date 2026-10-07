import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildMessage, content } from "../src/testing";
import {
  ANA_LID,
  ANA_PN,
  BOB_LID,
  BOB_PN,
  GROUP,
  ME_LID,
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

function addToCollection(chatJid: string) {
  h.store.db.run("INSERT OR IGNORE INTO collections (name, created_at) VALUES ('master', 0)");
  h.store.db
    .query("INSERT INTO collection_chats (collection, chat_jid) VALUES ('master', $chatJid)")
    .run({ chatJid });
}

const members = () =>
  h.store.db
    .query<{ chat_jid: string }, []>("SELECT chat_jid FROM collection_chats ORDER BY chat_jid")
    .all()
    .map((row) => row.chat_jid);

describe("one canonical jid per person", () => {
  test("the same contact as @lid and @s.whatsapp.net is one chat", async () => {
    await upsert(
      buildMessage({
        chat: ANA_LID,
        remoteJidAlt: ANA_PN,
        addressingMode: "lid",
        message: content.text("via lid"),
      }),
      buildMessage({ chat: ANA_PN, message: content.text("via pn") }),
    );
    expect(count(h.store, "SELECT * FROM chats")).toBe(1);
    expect(messageRows(h.store, ANA_PN).map((row) => [row.text, row.sender_jid])).toEqual([
      ["via lid", ANA_PN],
      ["via pn", ANA_PN],
    ]);
    expect(h.store.identity.chatForAlias(ANA_LID)).toBe(ANA_PN);
  });

  test("a group sender's LID resolves through participantAlt", async () => {
    await upsert(
      buildMessage({
        chat: GROUP,
        participant: ANA_LID,
        participantAlt: ANA_PN,
        addressingMode: "lid",
      }),
    );
    expect(messageRows(h.store, GROUP)[0]?.sender_jid).toBe(ANA_PN);
  });

  test("unknown LIDs are looked up in Baileys' LID store", async () => {
    await h.client.lidMapping.storeLIDPNMappings([{ lid: BOB_LID, pn: BOB_PN }]);
    await upsert(buildMessage({ chat: BOB_LID, message: content.text("hi") }));
    expect(messageRows(h.store, BOB_PN).map((row) => row.text)).toEqual(["hi"]);
  });

  test("without any mapping the LID is the canonical jid", async () => {
    await upsert(buildMessage({ chat: BOB_LID, message: content.text("who?") }));
    expect(h.store.chats.get(BOB_LID)?.kind).toBe("dm");
  });

  test("own LID and PN are the self chat", async () => {
    await upsert(
      buildMessage({ chat: ME_LID, fromMe: true, message: content.text("lid note") }),
      buildMessage({ chat: ME_PN, fromMe: true, message: content.text("pn note") }),
    );
    expect(h.store.chats.get(ME_PN)?.kind).toBe("self");
    expect(messageRows(h.store, ME_PN)).toHaveLength(2);
    expect(h.store.chats.get(ME_LID)).toBeNull();
  });
});

describe("a mapping learned later", () => {
  beforeEach(async () => {
    await h.emit({
      "groups.upsert": [
        {
          id: GROUP,
          subject: "PP",
          owner: undefined,
          participants: [{ id: BOB_LID, admin: "admin" }],
        },
      ],
    });
    await upsert(
      buildMessage({
        chat: BOB_LID,
        id: "3EB0DM1",
        ts: 100,
        pushName: "Bob",
        message: content.text("first"),
      }),
      buildMessage({
        chat: BOB_LID,
        id: "3EB0DUP",
        ts: 101,
        message: content.document({ fileName: "a.pdf" }),
      }),
      buildMessage({
        chat: GROUP,
        id: "3EB0GRP",
        participant: BOB_LID,
        message: content.text("in group"),
      }),
    );
    h.store.chats.upsert(BOB_LID, "dm", { archived: true });
    addToCollection(BOB_LID);
    // the same message also reached the PN chat
    await upsert(
      buildMessage({
        chat: BOB_PN,
        id: "3EB0DUP",
        ts: 101,
        message: content.document({ fileName: "a.pdf" }),
      }),
    );
    expect(count(h.store, "SELECT * FROM chats WHERE kind = 'dm'")).toBe(2);
  });

  test("merges the LID chat into the PN chat and keeps collection membership", async () => {
    await h.emit({ "lid-mapping.update": { lid: BOB_LID, pn: BOB_PN } });

    expect(h.store.chats.get(BOB_LID)).toBeNull();
    expect(h.store.chats.get(BOB_PN)).toMatchObject({ kind: "dm", archived: 1 });
    expect(members()).toEqual([BOB_PN]);
    expect(messageRows(h.store, BOB_PN).map((row) => row.id)).toEqual(["3EB0DM1", "3EB0DUP"]);
    expect(count(h.store, `SELECT * FROM media WHERE message_id = '3EB0DUP'`)).toBe(1);
    expect(h.store.identity.chatForAlias(BOB_LID)).toBe(BOB_PN);
  });

  test("re-points senders, participants and contacts to the PN", async () => {
    await h.emit({ "lid-mapping.update": { lid: BOB_LID, pn: BOB_PN } });

    expect(h.store.messages.get(GROUP, "3EB0GRP")).toMatchObject({
      sender_jid: BOB_PN,
      sender_alt: BOB_LID,
    });
    expect(h.store.participants.list(GROUP)).toEqual([{ jid: BOB_PN, role: "admin" }]);
    expect(h.store.contacts.get(BOB_LID)).toBeNull();
    expect(h.store.contacts.get(BOB_PN)).toMatchObject({
      lid: BOB_LID,
      phone: "40700000003",
      push_name: "Bob",
    });
  });

  test("later messages addressed to the LID land in the PN chat", async () => {
    await h.emit({ "lid-mapping.update": { lid: BOB_LID, pn: BOB_PN } });
    await upsert(buildMessage({ chat: BOB_LID, id: "3EB0LATER", message: content.text("later") }));
    expect(messageRows(h.store, BOB_PN).map((row) => row.id)).toContain("3EB0LATER");
    expect(h.store.chats.get(BOB_LID)).toBeNull();
  });

  test("a mapping found in a contact update merges too", async () => {
    await h.emit({ "contacts.upsert": [{ id: BOB_PN, lid: BOB_LID, name: "Bob B." }] });
    expect(h.store.chats.get(BOB_LID)).toBeNull();
    expect(members()).toEqual([BOB_PN]);
    expect(h.store.contacts.get(BOB_PN)).toMatchObject({ name: "Bob B.", lid: BOB_LID });
  });
});

describe("quotes", () => {
  test("quoted participants and chats are canonical", async () => {
    await h.emit({ "lid-mapping.update": { lid: ANA_LID, pn: ANA_PN } });
    const original = buildMessage({
      chat: GROUP,
      participant: ANA_LID,
      message: content.text("quoted"),
    });
    await upsert(buildMessage({ chat: ANA_LID, message: content.reply("privately", original) }));
    const row = h.store.db
      .query<{ quoted_chat_jid: string; quoted_participant: string }, []>(
        "SELECT quoted_chat_jid, quoted_participant FROM messages",
      )
      .get();
    expect(row).toEqual({ quoted_chat_jid: GROUP, quoted_participant: ANA_PN });
  });
});
