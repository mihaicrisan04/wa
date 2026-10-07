import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { proto, type WAMessage } from "@whiskeysockets/baileys";
import {
  ANA_LID,
  ANA_PN,
  BOB_LID,
  BOB_PN,
  buildMessage,
  content,
  EVE_PN,
  GROUP,
  historySet,
  keyOf,
  type FakeWhatsAppClient,
} from "../src/testing";
import { harness, messageRows, type Harness } from "./support/harness";

let h: Harness;

beforeEach(() => {
  h = harness();
});
afterEach(() => h.close());

const upsert = (...messages: WAMessage[]) =>
  h.emit({ "messages.upsert": { messages, type: "notify" } });

const REVOKE = proto.WebMessageInfo.StubType.REVOKE;

const target = () =>
  buildMessage({
    chat: GROUP,
    id: "3EB0GONE",
    participant: ANA_PN,
    message: content.image({ caption: "secret" }),
  });

const groupWithAdmin = (admin: string) =>
  h.emit({
    "groups.upsert": [
      {
        id: GROUP,
        subject: "PP",
        owner: undefined,
        participants: [
          { id: ANA_PN, admin: null },
          { id: admin, admin: "admin" },
        ],
      },
    ],
  });

/** What Baileys emits for a revoke carrier: an update keyed by the target, holding the carrier's key. */
function revokeUpdate(carrier: WAMessage, targetId: string) {
  return {
    key: { ...keyOf(carrier), id: targetId },
    update: { message: null, messageStubType: REVOKE, key: keyOf(carrier) },
  };
}

/** Baileys folds the revoke into the buffered target, overwriting the target's key with the carrier's. */
function foldRevoke(client: FakeWhatsAppClient, message: WAMessage, revoker: string) {
  const carrier = buildMessage({
    chat: GROUP,
    participant: revoker,
    message: content.revoke(keyOf(message)),
  });
  client.emit("messages.upsert", { messages: [carrier], type: "notify" });
  client.emit("messages.update", [revokeUpdate(carrier, message.key.id!)]);
}

/** The target's sender is lost when Baileys folds a revoke, so nothing is kept until a copy comes. */
const foldedPlaceholder = expect.objectContaining({
  id: "3EB0GONE",
  type: "placeholder",
  caption: null,
  sender_jid: null,
  deleted_at: null,
});

const tombstone = expect.objectContaining({
  id: "3EB0GONE",
  type: "revoked",
  caption: null,
  sender_jid: ANA_PN,
  deleted_at: expect.any(Number),
});

function expectGone() {
  expect(h.store.messages.search("secret")).toEqual([]);
  expect(h.store.media.get({ chatJid: GROUP, id: "3EB0GONE" })).toBeNull();
  expect(h.ingest.messageContent(keyOf(target()))).toBeUndefined();
}

describe("revokes", () => {
  test("the sender's revoke clears content and keeps a tombstone", async () => {
    const message = target();
    await upsert(message);
    await upsert(
      buildMessage({ chat: GROUP, participant: ANA_PN, message: content.revoke(keyOf(message)) }),
    );

    expect(h.store.messages.get({ chatJid: GROUP, id: "3EB0GONE" })).toMatchObject({
      type: "revoked",
      caption: null,
      has_media: 0,
    });
    expect(h.store.messages.get({ chatJid: GROUP, id: "3EB0GONE" })?.deleted_at).toBeGreaterThan(0);
    expectGone();
  });

  test("a group admin may revoke someone else's message", async () => {
    await groupWithAdmin(BOB_PN);
    await upsert(target());
    await h.emit({
      "messages.update": [
        {
          key: { remoteJid: GROUP, id: "3EB0GONE", fromMe: false, participant: BOB_PN },
          update: { message: null, messageStubType: REVOKE },
        },
      ],
    });
    expect(h.store.messages.get({ chatJid: GROUP, id: "3EB0GONE" })?.type).toBe("revoked");
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
          update: { message: null, messageStubType: REVOKE },
        },
      ],
    });
    expect(h.store.messages.get({ chatJid: GROUP, id: "3EB0GONE" })).toMatchObject({
      type: "image",
      caption: "secret",
      deleted_at: null,
    });
  });

  test("history tombstones are stored as revoked", async () => {
    await h.emit({
      "messages.upsert": {
        type: "append",
        messages: [buildMessage({ chat: ANA_PN, id: "3EB0OLD", message: null, stubType: REVOKE })],
      },
    });
    expect(h.store.messages.get({ chatJid: ANA_PN, id: "3EB0OLD" })?.type).toBe("revoked");
  });
});

describe("a revoke that arrives before its message can be checked", () => {
  test("folded into a buffered message, it keeps every later copy unreadable", async () => {
    await h.buffered((client) => {
      const message = target();
      client.emit("messages.upsert", { messages: [message], type: "notify" });
      foldRevoke(client, message, ANA_PN);
    });
    expect(messageRows(h.store, GROUP)).toEqual([foldedPlaceholder]);
    expectGone();

    await h.emit({ "messaging-history.set": historySet({ messages: [target()] }) });
    expect(messageRows(h.store, GROUP)).toEqual([tombstone]);
    expectGone();
    await upsert(target());
    expect(messageRows(h.store, GROUP)).toEqual([tombstone]);
    expectGone();
  });

  test("folded into a buffered history message, it keeps a later copy unreadable", async () => {
    await h.buffered((client) => {
      const message = target();
      client.emit("messaging-history.set", historySet({ messages: [message] }));
      foldRevoke(client, message, ANA_PN);
    });
    expect(messageRows(h.store, GROUP)).toEqual([foldedPlaceholder]);
    expectGone();

    await upsert(target());
    expect(messageRows(h.store, GROUP)).toEqual([tombstone]);
    expectGone();
  });

  test("folded and spoofed, it lets the genuine copy through", async () => {
    await h.buffered((client) => {
      const message = target();
      client.emit("messages.upsert", { messages: [message], type: "notify" });
      foldRevoke(client, message, EVE_PN);
    });
    expect(messageRows(h.store, GROUP)).toEqual([foldedPlaceholder]);

    await h.emit({ "messaging-history.set": historySet({ messages: [target()] }) });
    expect(messageRows(h.store, GROUP)).toEqual([
      expect.objectContaining({ id: "3EB0GONE", type: "image", caption: "secret" }),
    ]);
  });

  test("for a message not stored yet, it applies once the message comes", async () => {
    const message = target();
    await upsert(
      buildMessage({ chat: GROUP, participant: ANA_PN, message: content.revoke(keyOf(message)) }),
    );
    expect(messageRows(h.store, GROUP)).toEqual([]);

    await h.emit({ "messaging-history.set": historySet({ messages: [message] }) });
    expect(messageRows(h.store, GROUP)).toEqual([tombstone]);
    expectGone();
  });

  test("for a message not stored yet, a spoofed one is dropped when the message comes", async () => {
    const message = target();
    await upsert(
      buildMessage({ chat: GROUP, participant: EVE_PN, message: content.revoke(keyOf(message)) }),
    );
    await upsert(message);
    expect(h.store.messages.get({ chatJid: GROUP, id: "3EB0GONE" })).toMatchObject({
      type: "image",
      caption: "secret",
    });
  });
});

describe("a revoker addressed by LID", () => {
  test("is the sender stored under the PN", async () => {
    const message = target();
    await upsert(message);
    await upsert(
      buildMessage({
        chat: GROUP,
        participant: ANA_LID,
        participantAlt: ANA_PN,
        addressingMode: "lid",
        message: content.revoke(keyOf(message)),
      }),
    );
    expect(messageRows(h.store, GROUP)).toEqual([tombstone]);
  });

  test("is the group admin stored under the PN", async () => {
    await groupWithAdmin(BOB_PN);
    await upsert(target());
    await h.emit({
      "messages.update": [
        {
          key: {
            remoteJid: GROUP,
            id: "3EB0GONE",
            fromMe: false,
            participant: BOB_LID,
            participantAlt: BOB_PN,
            addressingMode: "lid",
          },
          update: { message: null, messageStubType: REVOKE },
        },
      ],
    });
    expect(messageRows(h.store, GROUP)).toEqual([tombstone]);
  });
});
