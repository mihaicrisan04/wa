import { afterEach, beforeEach, expect, test } from "bun:test";
import { proto } from "@whiskeysockets/baileys";
import { buildMessage, content, keyOf } from "../src/testing";
import {
  ANA_PN,
  BOB_PN,
  EVE_PN,
  GROUP,
  harness,
  messageRows,
  type Harness,
} from "./support/harness";

/** Edits and revokes that reach a message before its content does. */

let h: Harness;

beforeEach(() => {
  h = harness();
});
afterEach(() => h.close());

const upsert = (...messages: ReturnType<typeof buildMessage>[]) =>
  h.emit({ "messages.upsert": { messages, type: "notify" } });

const ID = "3EB0LATE";

/** The CIPHERTEXT stub Baileys emits when a message could not be decrypted yet. */
const stub = () =>
  buildMessage({
    chat: GROUP,
    id: ID,
    participant: ANA_PN,
    ts: 1_700_000_000,
    message: null,
    stubType: proto.WebMessageInfo.StubType.CIPHERTEXT,
  });

const decrypted = (message: proto.IMessage) =>
  buildMessage({ chat: GROUP, id: ID, participant: ANA_PN, ts: 1_700_000_000, message });

const from = (participant: string, message: proto.IMessage) =>
  buildMessage({ chat: GROUP, participant, message });

test("a revoke of a message not decrypted yet keeps a tombstone the content cannot fill", async () => {
  await upsert(stub());
  await upsert(from(ANA_PN, content.revoke(keyOf(stub()))));
  expect(messageRows(h.store, GROUP)[0]).toMatchObject({ type: "revoked", text: null });
  expect(messageRows(h.store, GROUP)[0]!.deleted_at).toBeGreaterThan(0);

  await upsert(decrypted(content.text("secret")));
  expect(messageRows(h.store, GROUP)).toEqual([
    expect.objectContaining({ id: ID, type: "revoked", text: null }),
  ]);
  expect(h.store.search("secret")).toEqual([]);
  expect(h.ingest.messageContent(keyOf(stub()))).toBeUndefined();
});

test("a spoofed revoke of a message not decrypted yet is ignored", async () => {
  await upsert(stub());
  await upsert(from(EVE_PN, content.revoke(keyOf(stub()))));
  await upsert(decrypted(content.text("still here")));
  expect(messageRows(h.store, GROUP)[0]).toMatchObject({
    type: "text",
    text: "still here",
    deleted_at: null,
  });
});

test("an edit of a message not decrypted yet survives the original arriving", async () => {
  await upsert(stub());
  await upsert(from(ANA_PN, content.edit(keyOf(stub()), "v2", 1_700_000_100_000)));
  expect(messageRows(h.store, GROUP)[0]).toMatchObject({ type: "text", text: "v2" });

  await upsert(decrypted(content.text("v1")));
  expect(messageRows(h.store, GROUP)).toEqual([
    expect.objectContaining({ id: ID, type: "text", text: "v2", edited_at: 1_700_000_100 }),
  ]);
  expect(h.store.search("v1")).toEqual([]);
  expect(h.ingest.messageContent(keyOf(stub()))).toMatchObject({ conversation: "v2" });
});

test("a caption edited before decrypting keeps the original's media", async () => {
  await upsert(stub());
  await upsert(from(ANA_PN, content.edit(keyOf(stub()), "after", 1_700_000_100_000)));
  await upsert(decrypted(content.image({ caption: "before" })));

  expect(h.store.messages.get(GROUP, ID)).toMatchObject({
    type: "image",
    caption: "after",
    has_media: 1,
    edited_at: 1_700_000_100,
  });
  expect(h.store.media.get({ chatJid: GROUP, id: ID })).toMatchObject({ kind: "image" });
  expect(h.ingest.messageContent(keyOf(stub()))?.imageMessage).toMatchObject({
    caption: "after",
  });
});

test("a spoofed edit of a message not decrypted yet is ignored", async () => {
  await upsert(stub());
  await upsert(from(EVE_PN, content.edit(keyOf(stub()), "pwned")));
  await upsert(decrypted(content.text("v1")));
  expect(messageRows(h.store, GROUP)[0]).toMatchObject({ text: "v1", edited_at: null });
  expect(h.store.search("pwned")).toEqual([]);
});

test("a spoofed revoke folded into a buffered message leaves a placeholder the real copy fills", async () => {
  const target = decrypted(content.text("keep me"));
  await h.buffered((client) => {
    const carrier = from(BOB_PN, content.revoke(keyOf(target)));
    client.emit("messages.upsert", { messages: [target], type: "notify" });
    client.emit("messages.upsert", { messages: [carrier], type: "notify" });
    client.emit("messages.update", [
      {
        key: { ...keyOf(carrier), id: ID },
        update: {
          message: null,
          messageStubType: proto.WebMessageInfo.StubType.REVOKE,
          key: keyOf(carrier),
        },
      },
    ]);
  });
  expect(messageRows(h.store, GROUP)).toEqual([
    expect.objectContaining({ id: ID, type: "placeholder", deleted_at: null, ts: 1_700_000_000 }),
  ]);

  await upsert(decrypted(content.text("keep me")));
  expect(messageRows(h.store, GROUP)).toEqual([
    expect.objectContaining({ id: ID, type: "text", text: "keep me", sender_jid: ANA_PN }),
  ]);
});
