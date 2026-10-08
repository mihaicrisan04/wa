import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, openDatabase } from "../src/store/db";
import { MIGRATIONS } from "../src/store/migrations";
import { nowSeconds } from "../src/clock";
import { openStore, toFtsQuery, type MessageRecord, type Store } from "../src/store";
import { ANA_PN, messageRecord } from "../src/testing";
import { count } from "./support/harness";

let store: Store;

beforeEach(() => {
  store = openStore(":memory:");
});
afterEach(() => store.close());

const textOf = () => store.messages.get({ chatJid: ANA_PN, id: "3EB0A" })?.text;

describe("migrations", () => {
  test("apply once and record their version", () => {
    const db = openDatabase(":memory:");
    expect(db.query("SELECT version FROM schema_migrations").all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    migrate(db, MIGRATIONS);
    expect(count({ db } as Store, "SELECT * FROM schema_migrations")).toBe(2);
    db.close();
  });

  test("clear masked phone numbers stored as names, keeping real ones", () => {
    const db = new Database(":memory:", { strict: true });
    migrate(db, MIGRATIONS.slice(0, 1));
    const masked = "+40\u2219\u2219\u2219\u2219\u2219\u2219\u221950";
    db.run(
      `INSERT INTO contacts (jid, name, push_name, updated_at) VALUES
         ('masked', '${masked}', 'Ana Pop', 0), ('saved', 'Ana from work', 'Ana Pop', 0),
         ('number', '+40 700 000 002', NULL, 0)`,
    );
    db.run(
      `INSERT INTO chats (jid, kind, name, updated_at) VALUES ('masked', 'dm', '${masked}', 0)`,
    );
    migrate(db, MIGRATIONS);
    expect(db.query("SELECT jid, name FROM contacts ORDER BY jid").all()).toEqual([
      { jid: "masked", name: null },
      { jid: "number", name: "+40 700 000 002" },
      { jid: "saved", name: "Ana from work" },
    ]);
    expect(db.query("SELECT name FROM chats").all()).toEqual([{ name: null }]);
    db.close();
  });

  test("create every table of the schema", () => {
    const tables = store.db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    for (const table of [
      "chats",
      "chat_aliases",
      "lid_map",
      "contacts",
      "group_participants",
      "messages",
      "messages_fts",
      "pending_revokes",
      "media",
      "collections",
      "collection_chats",
      "profiles",
      "profile_collections",
      "tokens",
      "outbox",
      "audit_log",
      "sync_state",
      "schema_migrations",
    ]) {
      expect(tables).toContain(table);
    }
  });

  test("enforce the chat kind and message source checks", () => {
    expect(() =>
      store.db.run("INSERT INTO chats (jid, kind, updated_at) VALUES ('x', 'nope', 0)"),
    ).toThrow();
    expect(() => store.messages.upsert(messageRecord({ source: "nope" as "live" }))).toThrow();
  });
});

describe("message upserts", () => {
  test("a placeholder is replaced by content", () => {
    store.messages.upsert(messageRecord({ type: "placeholder", text: null }));
    expect(store.messages.upsert(messageRecord({ text: "decrypted" }))).toBe(true);
    expect(textOf()).toBe("decrypted");
  });

  test("content is never replaced by a placeholder", () => {
    store.messages.upsert(messageRecord());
    expect(store.messages.upsert(messageRecord({ type: "placeholder", text: null }))).toBe(false);
    expect(textOf()).toBe("hello");
  });

  test("a later copy with content refreshes the row but keeps the first source", () => {
    store.messages.upsert(messageRecord({ source: "live" }));
    store.messages.upsert(messageRecord({ source: "history", text: "hello again" }));
    expect(store.messages.get({ chatJid: ANA_PN, id: "3EB0A" })).toMatchObject({
      text: "hello again",
      source: "live",
    });
  });

  test("a tombstone is never resurrected", () => {
    store.messages.upsert(messageRecord());
    store.messages.tombstone({ chatJid: ANA_PN, id: "3EB0A" }, 1_700_000_100, null);
    expect(store.messages.upsert(messageRecord({ text: "old copy" }))).toBe(false);
    store.messages.updateRaw({ chatJid: ANA_PN, id: "3EB0A" }, '{"message":{}}');
    expect(store.messages.get({ chatJid: ANA_PN, id: "3EB0A" })).toMatchObject({
      type: "revoked",
      text: null,
      raw: null,
    });
  });

  test("an older copy never reverts an edit", () => {
    store.messages.upsert(messageRecord());
    store.messages.applyEdit(
      { chatJid: ANA_PN, id: "3EB0A" },
      { type: "text", text: "edited", caption: null, editedAt: 1_700_000_200, raw: "{}" },
    );
    expect(store.messages.upsert(messageRecord({ text: "hello" }))).toBe(false);
    expect(textOf()).toBe("edited");
  });

  test("an incoming tombstone wins over content", () => {
    store.messages.upsert(messageRecord());
    store.messages.upsert(messageRecord({ type: "revoked", text: null, deletedAt: 1_700_000_100 }));
    expect(store.messages.get({ chatJid: ANA_PN, id: "3EB0A" })).toMatchObject({
      type: "revoked",
      deleted_at: 1_700_000_100,
    });
  });
});

describe("full-text search", () => {
  function add(id: string, overrides: Partial<MessageRecord>) {
    store.messages.upsert(messageRecord({ id, ...overrides }));
  }

  test("ignores diacritics in both directions", () => {
    add("1", { text: "Am terminat sarcină de la PP" });
    add("2", { text: "Ștefan a trimis tema" });
    add("3", { text: "nimic aici" });
    expect(store.messages.search("sarcina").map((hit) => hit.id)).toEqual(["1"]);
    expect(store.messages.search("stefan").map((hit) => hit.id)).toEqual(["2"]);
    expect(store.messages.search("ȘTEFAN").map((hit) => hit.id)).toEqual(["2"]);
  });

  test("searches captions and file names, prefix-matching the last term", () => {
    add("1", { type: "document", text: null, caption: "rezolvare", fileName: "tema-2.pdf" });
    expect(store.messages.search("rezolv").map((hit) => hit.id)).toEqual(["1"]);
    expect(store.messages.search("tema-2").map((hit) => hit.id)).toEqual(["1"]);
  });

  test("survives FTS syntax in user input", () => {
    add("1", { text: "don't forget c++ and PP: lab 3" });
    for (const query of ["tema-2", "don't", "c++", "PP:", 'AND OR NOT "', "NEAR(", "*", "a OR"]) {
      expect(() => store.messages.search(query)).not.toThrow();
    }
    expect(store.messages.search("don't").map((hit) => hit.id)).toEqual(["1"]);
    expect(store.messages.search("c++").map((hit) => hit.id)).toEqual(["1"]);
    expect(store.messages.search("PP:").map((hit) => hit.id)).toEqual(["1"]);
  });

  test("returns a snippet and hides revoked or deleted messages", () => {
    add("1", { text: "meet at the library tomorrow" });
    add("2", { text: "library card" });
    store.messages.tombstone({ chatJid: ANA_PN, id: "2" }, 1, null);
    const hits = store.messages.search("library");
    expect(hits.map((hit) => hit.id)).toEqual(["1"]);
    expect(hits[0]!.snippet).toContain("\u0002library\u0003");

    store.messages.delete({ chatJid: ANA_PN, id: "1" });
    expect(store.messages.search("library")).toEqual([]);
    expect(count(store, "SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'library'")).toBe(
      0,
    );
  });

  test("can be limited by a condition on the message", () => {
    add("1", { text: "shared word" });
    store.messages.upsert(
      messageRecord({ chatJid: "other@s.whatsapp.net", id: "2", text: "shared word" }),
    );
    const where = { sql: "m.chat_jid = $chat", params: { chat: "other@s.whatsapp.net" } };
    expect(store.messages.search("shared", { where }).map((hit) => hit.id)).toEqual(["2"]);
  });
});

describe("toFtsQuery", () => {
  test("quotes every term and prefixes the last", () => {
    expect(toFtsQuery("tema-2")).toBe('"tema-2"*');
    expect(toFtsQuery("don't")).toBe(`"don't"*`);
    expect(toFtsQuery("c++")).toBe('"c++"*');
    expect(toFtsQuery("PP: lab")).toBe('"PP:" "lab"*');
    expect(toFtsQuery('say "hi"')).toBe('"say" """hi"""*');
  });

  test("drops input with nothing searchable", () => {
    expect(toFtsQuery("")).toBeNull();
    expect(toFtsQuery('  " * - ')).toBeNull();
  });
});

describe("chats", () => {
  test("partial updates only touch the fields given", () => {
    store.chats.upsert(ANA_PN, "dm", {
      name: "Ana",
      pinned: 1_700_000_000,
      muteEndTime: 1_800_000_000,
    });
    store.chats.upsert(ANA_PN, "dm", { archived: true });
    expect(store.chats.get(ANA_PN)).toMatchObject({
      name: "Ana",
      archived: 1,
      pinned: 1_700_000_000,
      mute_end_time: 1_800_000_000,
    });
    store.chats.upsert(ANA_PN, "dm", { pinned: null, muteEndTime: null, unread: { set: -1 } });
    expect(store.chats.get(ANA_PN)).toMatchObject({
      pinned: null,
      mute_end_time: null,
      unread_count: -1,
    });
  });

  test("last message time only moves forward", () => {
    store.chats.upsert(ANA_PN, "dm", { lastMessageAt: 200 });
    store.chats.upsert(ANA_PN, "dm", { lastMessageAt: 100 });
    store.chats.touch(ANA_PN, 150);
    expect(store.chats.get(ANA_PN)?.last_message_at).toBe(200);
    store.chats.touch(ANA_PN, 300);
    expect(store.chats.get(ANA_PN)?.last_message_at).toBe(300);
  });
});

describe("profiles", () => {
  const spec = { name: "agent", capabilities: [], allChats: false, collections: ["missing"] };

  test("a profile naming a missing collection is not created at all", () => {
    expect(() => store.profiles.create(spec)).toThrow();
    expect(store.profiles.get("agent")).toBeNull();
  });

  test("putting a missing collection leaves the existing profile as it was", () => {
    store.collections.create("master", null);
    store.profiles.put({ ...spec, collections: ["master"] });
    expect(() => store.profiles.put({ ...spec, allChats: true })).toThrow();
    expect(store.profiles.get("agent")).toMatchObject({ allChats: false, collections: ["master"] });
  });
});

describe("disappearing messages", () => {
  test("are purged with their media once expired", () => {
    const now = nowSeconds();
    store.messages.upsert(messageRecord({ id: "old", expiresAt: now + 100, media: null }));
    store.media.upsert(
      { chatJid: ANA_PN, id: "old" },
      { kind: "image", mimetype: "image/jpeg", fileName: null, size: 1 },
    );
    store.media.markDownloaded({ chatJid: ANA_PN, id: "old" }, "/tmp/wa-test-media.jpeg", 1);
    store.messages.upsert(messageRecord({ id: "new", expiresAt: now + 10_000 }));
    store.messages.upsert(messageRecord({ id: "keeps", expiresAt: null }));

    expect(store.purgeExpired(now + 500)).toEqual(["/tmp/wa-test-media.jpeg"]);
    expect(count(store, "SELECT id FROM messages")).toBe(2);
    expect(count(store, "SELECT * FROM media")).toBe(0);
  });

  test("purging also drops revokes that waited a month for their message", () => {
    const now = nowSeconds();
    const actor = { fromMe: false, jid: ANA_PN };
    store.pendingRevokes.add({ chatJid: ANA_PN, id: "stale" }, { actor, ts: now - 31 * 86_400 });
    store.pendingRevokes.add({ chatJid: ANA_PN, id: "fresh" }, { actor, ts: now - 86_400 });

    store.purgeExpired(now);
    expect(store.pendingRevokes.take({ chatJid: ANA_PN, id: "stale" })).toEqual([]);
    expect(store.pendingRevokes.take({ chatJid: ANA_PN, id: "fresh" })).toHaveLength(1);
  });
});

describe("sync state", () => {
  test("keeps the latest history phases until they are cleared", () => {
    const phase = { progress: 42, status: null, explicit: null, chunks: 1, updatedAt: 1 };
    expect(store.sync.historyPhases()).toEqual({});
    store.sync.setHistoryPhases({ full: phase });
    store.sync.setHistoryPhases({ full: { ...phase, progress: 43 } });
    expect(store.sync.historyPhases()).toEqual({ full: { ...phase, progress: 43 } });
    store.sync.clearHistoryPhases();
    expect(store.sync.historyPhases()).toEqual({});
  });
});
