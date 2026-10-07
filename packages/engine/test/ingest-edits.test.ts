import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildMessage, content, historySet, keyOf } from "../src/testing";
import {
  ANA_LID,
  ANA_PN,
  EVE_PN,
  GROUP,
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

  test("the sender addressed by LID edits the message stored under the PN", async () => {
    const target = original();
    await upsert(target);
    const lidKey = { participant: ANA_LID, participantAlt: ANA_PN, addressingMode: "lid" as const };
    await upsert(
      buildMessage({ chat: GROUP, ...lidKey, message: content.edit(keyOf(target), "v2") }),
    );
    expect(messageRows(h.store, GROUP)[0]).toMatchObject({ text: "v2" });

    await h.emit({
      "messages.update": [
        {
          key: { ...keyOf(target), ...lidKey },
          update: {
            message: { editedMessage: { message: { conversation: "v3" } } },
            messageTimestamp: 1_900_000_000,
          },
        },
      ],
    });
    expect(messageRows(h.store, GROUP)[0]).toMatchObject({ text: "v3", edited_at: 1_900_000_000 });
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

  test("a spoofed edit folded into a buffered history message drops the forged text", async () => {
    await h.buffered((client) => {
      const target = original();
      client.emit("messaging-history.set", historySet({ messages: [target] }));
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
