import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { databasePath } from "../src/config";
import { reindex } from "../src/ingest";
import { reindexHome } from "../src/maintenance";
import { openStore } from "../src/store";
import { buildMessage, content, keyOf, makeTempHome, type TempHome } from "../src/testing";
import {
  ANA_PN,
  ME_LID,
  ME_PN,
  harness,
  messageRows,
  silent,
  type Harness,
} from "./support/harness";

let h: Harness;

beforeEach(() => {
  h = harness();
});
afterEach(() => h.close());

test("re-derives every row from raw, keeping edits and tombstones", async () => {
  const edited = buildMessage({
    chat: ANA_PN,
    id: "3EB0EDIT",
    ts: 100,
    message: content.text("v1"),
  });
  const revoked = buildMessage({
    chat: ANA_PN,
    id: "3EB0GONE",
    ts: 101,
    message: content.text("secret"),
  });
  await h.emit({
    "messages.upsert": {
      messages: [
        edited,
        revoked,
        buildMessage({ chat: ANA_PN, id: "3EB0PLAIN", ts: 102, message: content.text("căutare") }),
        buildMessage({
          chat: ANA_PN,
          id: "3EB0ONCE",
          ts: 103,
          message: content.viewOnce(content.image()),
        }),
      ],
      type: "notify",
    },
  });
  await h.emit({
    "messages.upsert": {
      messages: [
        buildMessage({ chat: ANA_PN, message: content.edit(keyOf(edited), "v2", 200_000) }),
        buildMessage({ chat: ANA_PN, message: content.revoke(keyOf(revoked)) }),
      ],
      type: "notify",
    },
  });
  const before = messageRows(h.store, ANA_PN);
  h.store.db.run(
    "UPDATE messages SET type = 'junk', text = 'junk', caption = 'junk' WHERE raw IS NOT NULL",
  );
  h.store.db.run("INSERT INTO messages_fts (messages_fts) VALUES ('delete-all')");

  expect(reindex(h.store, { pn: ME_PN, lid: ME_LID }, silent)).toEqual({
    rewritten: 3,
    skipped: 1,
  });

  const after = messageRows(h.store, ANA_PN);
  expect(after).toEqual(before);
  expect(after.find((row) => row.id === "3EB0EDIT")).toMatchObject({ text: "v2", edited_at: 200 });
  expect(after.find((row) => row.id === "3EB0GONE")).toMatchObject({ type: "revoked", text: null });
  expect(h.store.search("cautare").map((hit) => hit.id)).toEqual(["3EB0PLAIN"]);
  expect(h.store.search("junk")).toEqual([]);
});

test("a tombstone stays content-free even if its raw still holds the content", async () => {
  const message = buildMessage({
    chat: ANA_PN,
    id: "3EB0GONE",
    message: content.image({ caption: "private caption" }),
  });
  await h.emit({ "messages.upsert": { messages: [message], type: "notify" } });
  const contentRaw = h.store.messages.get(ANA_PN, "3EB0GONE")!.raw;
  await h.emit({
    "messages.upsert": {
      messages: [buildMessage({ chat: ANA_PN, message: content.revoke(keyOf(message)) })],
      type: "notify",
    },
  });
  h.store.db.query("UPDATE messages SET raw = $raw WHERE id = '3EB0GONE'").run({ raw: contentRaw });

  reindex(h.store, { pn: ME_PN, lid: ME_LID }, silent);

  const row = h.store.messages.get(ANA_PN, "3EB0GONE")!;
  expect(row).toMatchObject({ type: "revoked", caption: null, has_media: 0 });
  expect(row.deleted_at).toBeGreaterThan(0);
  expect(row.raw).not.toContain("private caption");
  expect(h.store.media.get({ chatJid: ANA_PN, id: "3EB0GONE" })).toBeNull();
});

let temp: TempHome;

test("reindexHome works on the database file and skips a missing one", async () => {
  temp = await makeTempHome();
  try {
    expect(await reindexHome(temp.home, silent)).toBeNull();
    await mkdir(join(temp.home, "auth"), { recursive: true });
    const store = openStore(databasePath(temp.home));
    store.messages.upsert({
      chatJid: ANA_PN,
      id: "3EB0X",
      fromMe: false,
      senderJid: ANA_PN,
      senderAlt: null,
      ts: 1,
      type: "junk",
      text: "junk",
      caption: null,
      fileName: null,
      quotedId: null,
      quotedChatJid: null,
      quotedParticipant: null,
      quotedText: null,
      editedAt: null,
      deletedAt: null,
      expiresAt: null,
      viewOnce: false,
      source: "live",
      raw: JSON.stringify({
        key: { remoteJid: ANA_PN, id: "3EB0X", fromMe: false },
        messageTimestamp: "1",
        message: { conversation: "real text" },
      }),
      media: null,
    });
    store.close();

    expect(await reindexHome(temp.home, silent)).toEqual({ rewritten: 1, skipped: 0 });
    const reopened = openStore(databasePath(temp.home));
    expect(reopened.messages.get(ANA_PN, "3EB0X")).toMatchObject({
      type: "text",
      text: "real text",
    });
    reopened.close();
  } finally {
    await temp.cleanup();
  }
});
