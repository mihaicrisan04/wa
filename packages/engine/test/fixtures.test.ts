import { describe, expect, test } from "bun:test";
import {
  extractMessageContent,
  getContentType,
  isJidGroup,
  normalizeMessageContent,
  proto,
  toNumber,
} from "@whiskeysockets/baileys";
import { buildMessage, content, historySet, keyOf } from "../src/testing";

describe("buildMessage", () => {
  test("behaves like a decoded WhatsApp payload", () => {
    const message = buildMessage({
      chat: "40700000002@s.whatsapp.net",
      ts: 1_700_000_123,
      message: content.image(),
    });

    expect(message.messageTimestamp).not.toBeTypeOf("number");
    expect(toNumber(message.messageTimestamp)).toBe(1_700_000_123);
    expect(message.message?.imageMessage?.mediaKey).toBeInstanceOf(Uint8Array);
    expect(message.message?.imageMessage?.fileLength).not.toBeTypeOf("number");
    expect(message.key).toMatchObject({ remoteJid: "40700000002@s.whatsapp.net", fromMe: false });
    expect(message.key.id).toStartWith("3EB0");
  });

  test("keeps the key alt fields that protobuf would drop", () => {
    const message = buildMessage({
      chat: "120363000000000001@g.us",
      participant: "111111111111111@lid",
      participantAlt: "40700000003@s.whatsapp.net",
      addressingMode: "lid",
    });
    expect(isJidGroup(message.key.remoteJid!)).toBe(true);
    expect(message.key).toMatchObject({
      participant: "111111111111111@lid",
      participantAlt: "40700000003@s.whatsapp.net",
      addressingMode: "lid",
    });
  });

  test("wrappers unwrap through Baileys helpers", () => {
    const viewOnce = buildMessage({
      chat: "x@s.whatsapp.net",
      message: content.viewOnce(content.image({ caption: "once" })),
    });
    const ephemeral = buildMessage({
      chat: "x@s.whatsapp.net",
      message: content.ephemeral(content.text("brb")),
    });

    expect(getContentType(normalizeMessageContent(viewOnce.message) ?? undefined)).toBe(
      "imageMessage",
    );
    expect(extractMessageContent(viewOnce.message)?.imageMessage?.caption).toBe("once");
    expect(normalizeMessageContent(ephemeral.message)?.conversation).toBe("brb");
  });

  test("builds edit, revoke and reaction carriers pointing at their target", () => {
    const target = buildMessage({ chat: "x@s.whatsapp.net", message: content.text("v1") });
    const edit = buildMessage({
      chat: "x@s.whatsapp.net",
      message: content.edit(keyOf(target), "v2"),
    });
    const revoke = buildMessage({
      chat: "x@s.whatsapp.net",
      message: content.revoke(keyOf(target)),
    });
    const reaction = buildMessage({
      chat: "x@s.whatsapp.net",
      message: content.reaction(keyOf(target), "👍"),
    });

    expect(edit.message?.protocolMessage).toMatchObject({
      type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
      key: { id: target.key.id },
      editedMessage: { conversation: "v2" },
    });
    expect(revoke.message?.protocolMessage?.type).toBe(proto.Message.ProtocolMessage.Type.REVOKE);
    expect(getContentType(reaction.message ?? undefined)).toBe("reactionMessage");
  });

  test("supports stub-only messages such as revoked history entries", () => {
    const stub = buildMessage({
      chat: "x@s.whatsapp.net",
      message: null,
      stubType: proto.WebMessageInfo.StubType.REVOKE,
    });
    expect(stub.message).toBeNull();
    expect(stub.messageStubType).toBe(proto.WebMessageInfo.StubType.REVOKE);
  });

  test("replies carry the quoted message", () => {
    const quoted = buildMessage({
      chat: "120363000000000001@g.us",
      participant: "40700000004@s.whatsapp.net",
    });
    const reply = buildMessage({
      chat: "40700000004@s.whatsapp.net",
      message: content.reply("privately", quoted),
    });
    expect(reply.message?.extendedTextMessage?.contextInfo).toMatchObject({
      stanzaId: quoted.key.id,
      remoteJid: "120363000000000001@g.us",
      participant: "40700000004@s.whatsapp.net",
    });
  });
});

test("historySet defaults to a finished FULL sync", () => {
  expect(historySet()).toMatchObject({
    syncType: proto.HistorySync.HistorySyncType.FULL,
    progress: 100,
    isLatest: true,
  });
});
