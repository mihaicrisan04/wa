import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { proto } from "@whiskeysockets/baileys";
import { buildMessage, content, keyOf } from "../src/testing";
import {
  ANA_PN,
  BOB_PN,
  EVE_PN,
  GROUP,
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

describe("edits", () => {
  const original = () =>
    buildMessage({
      chat: GROUP,
      id: "3EB0ORIG",
      participant: ANA_PN,
      ts: 1_700_000_000,
      message: content.text("v1"),
    });

  test("a carrier from the sender edits the stored message", async () => {
    const target = original();
    await upsert(target);
    await upsert(
      buildMessage({
        chat: GROUP,
        participant: ANA_PN,
        message: content.edit(keyOf(target), "v2"),
      }),
    );

    const [row] = messageRows(h.store, GROUP);
    expect(row).toMatchObject({ text: "v2" });
    expect(row!.edited_at).toBeGreaterThan(0);
    expect(h.store.search("v2").map((hit) => hit.id)).toEqual(["3EB0ORIG"]);
    expect(h.ingest.messageContent(keyOf(target))).toMatchObject({ conversation: "v2" });
  });

  test("a live update from the sender edits the stored message", async () => {
    await upsert(original());
    await h.emit({
      "messages.update": [
        {
          key: { remoteJid: GROUP, id: "3EB0ORIG", fromMe: false, participant: ANA_PN },
          update: {
            message: { editedMessage: { message: { conversation: "v3" } } },
            messageTimestamp: 1_700_000_900,
          },
        },
      ],
    });
    expect(messageRows(h.store, GROUP)[0]).toMatchObject({ text: "v3", edited_at: 1_700_000_900 });
  });

  test("a spoofed edit from someone else is ignored", async () => {
    const target = original();
    await upsert(target);
    await upsert(
      buildMessage({
        chat: GROUP,
        participant: EVE_PN,
        message: content.edit(keyOf(target), "pwned"),
      }),
    );
    await h.emit({
      "messages.update": [
        {
          key: { remoteJid: GROUP, id: "3EB0ORIG", fromMe: false, participant: EVE_PN },
          update: { message: { editedMessage: { message: { conversation: "pwned" } } } },
        },
      ],
    });
    expect(messageRows(h.store, GROUP)[0]).toMatchObject({ text: "v1", edited_at: null });
  });

  test("an edit Baileys folded into a buffered message is kept when genuine", async () => {
    await h.buffered((client) => {
      const target = original();
      client.emit("messages.upsert", { messages: [target], type: "notify" });
      client.emit("messages.upsert", {
        messages: [
          buildMessage({
            chat: GROUP,
            participant: ANA_PN,
            message: content.edit(keyOf(target), "v2", 1_700_000_050_000),
          }),
        ],
        type: "notify",
      });
      client.emit("messages.update", [
        {
          key: { ...keyOf(target), participant: ANA_PN },
          update: {
            message: { editedMessage: { message: { conversation: "v2" } } },
            messageTimestamp: 1_700_000_050,
          },
        },
      ]);
    });
    expect(messageRows(h.store, GROUP)).toEqual([
      expect.objectContaining({ id: "3EB0ORIG", text: "v2", edited_at: 1_700_000_050 }),
    ]);
  });

  test("a spoofed edit folded into a buffered message drops the forged text", async () => {
    await h.buffered((client) => {
      const target = original();
      client.emit("messages.upsert", { messages: [target], type: "notify" });
      client.emit("messages.upsert", {
        messages: [
          buildMessage({
            chat: GROUP,
            participant: EVE_PN,
            message: content.edit(keyOf(target), "pwned"),
          }),
        ],
        type: "notify",
      });
      client.emit("messages.update", [
        {
          key: { ...keyOf(target), participant: EVE_PN },
          update: {
            message: { editedMessage: { message: { conversation: "pwned" } } },
            messageTimestamp: 1_700_000_050,
          },
        },
      ]);
    });
    expect(messageRows(h.store, GROUP)).toEqual([
      expect.objectContaining({ id: "3EB0ORIG", type: "placeholder", text: null }),
    ]);
    expect(h.store.search("pwned")).toEqual([]);

    // the genuine copy (e.g. from history) fills the placeholder
    await upsert(original());
    expect(messageRows(h.store, GROUP)[0]).toMatchObject({ type: "text", text: "v1" });
  });

  test("edits of media replace the caption and keep the media", async () => {
    const image = buildMessage({
      chat: ANA_PN,
      id: "3EB0IMG",
      message: content.image({ caption: "before" }),
    });
    await upsert(image);
    await upsert(buildMessage({ chat: ANA_PN, message: content.edit(keyOf(image), "after") }));
    expect(h.store.messages.get(ANA_PN, "3EB0IMG")).toMatchObject({
      type: "image",
      caption: "after",
      has_media: 1,
    });
    expect(h.ingest.messageContent(keyOf(image))?.imageMessage).toMatchObject({ caption: "after" });
  });
});

describe("revokes", () => {
  const target = () =>
    buildMessage({
      chat: GROUP,
      id: "3EB0GONE",
      participant: ANA_PN,
      message: content.image({ caption: "secret" }),
    });

  test("the sender's revoke clears content and keeps a tombstone", async () => {
    const message = target();
    await upsert(message);
    await upsert(
      buildMessage({ chat: GROUP, participant: ANA_PN, message: content.revoke(keyOf(message)) }),
    );

    expect(h.store.messages.get(GROUP, "3EB0GONE")).toMatchObject({
      type: "revoked",
      caption: null,
      has_media: 0,
    });
    expect(h.store.messages.get(GROUP, "3EB0GONE")?.deleted_at).toBeGreaterThan(0);
    expect(h.store.media.get({ chatJid: GROUP, id: "3EB0GONE" })).toBeNull();
    expect(h.store.search("secret")).toEqual([]);
    expect(h.ingest.messageContent(keyOf(message))).toBeUndefined();
  });

  test("a group admin may revoke someone else's message", async () => {
    await h.emit({
      "groups.upsert": [
        {
          id: GROUP,
          subject: "PP",
          owner: undefined,
          participants: [
            { id: ANA_PN, admin: null },
            { id: BOB_PN, admin: "admin" },
          ],
        },
      ],
    });
    await upsert(target());
    await h.emit({
      "messages.update": [
        {
          key: { remoteJid: GROUP, id: "3EB0GONE", fromMe: false, participant: BOB_PN },
          update: { message: null, messageStubType: proto.WebMessageInfo.StubType.REVOKE },
        },
      ],
    });
    expect(h.store.messages.get(GROUP, "3EB0GONE")?.type).toBe("revoked");
  });

  test("a spoofed revoke from a non-admin is ignored", async () => {
    const message = target();
    await upsert(message);
    await upsert(
      buildMessage({ chat: GROUP, participant: EVE_PN, message: content.revoke(keyOf(message)) }),
    );
    await h.emit({
      "messages.update": [
        {
          key: { remoteJid: GROUP, id: "3EB0GONE", fromMe: false, participant: EVE_PN },
          update: { message: null, messageStubType: proto.WebMessageInfo.StubType.REVOKE },
        },
      ],
    });
    expect(h.store.messages.get(GROUP, "3EB0GONE")).toMatchObject({
      type: "image",
      caption: "secret",
      deleted_at: null,
    });
  });

  test("a revoke Baileys folded into a buffered message leaves no content and no phantom row", async () => {
    await h.buffered((client) => {
      const message = target();
      const carrier = buildMessage({
        chat: GROUP,
        participant: ANA_PN,
        message: content.revoke(keyOf(message)),
      });
      client.emit("messages.upsert", { messages: [message], type: "notify" });
      client.emit("messages.upsert", { messages: [carrier], type: "notify" });
      client.emit("messages.update", [
        {
          key: { ...keyOf(carrier), id: message.key.id },
          update: {
            message: null,
            messageStubType: proto.WebMessageInfo.StubType.REVOKE,
            key: keyOf(carrier),
          },
        },
      ]);
    });
    expect(count(h.store, "SELECT * FROM messages")).toBe(0);
    expect(h.store.search("secret")).toEqual([]);
  });

  test("history tombstones are stored as revoked", async () => {
    await h.emit({
      "messages.upsert": {
        type: "append",
        messages: [
          buildMessage({
            chat: ANA_PN,
            id: "3EB0OLD",
            message: null,
            stubType: proto.WebMessageInfo.StubType.REVOKE,
          }),
        ],
      },
    });
    expect(h.store.messages.get(ANA_PN, "3EB0OLD")?.type).toBe("revoked");
  });
});
