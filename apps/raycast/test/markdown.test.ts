import { describe, expect, test } from "bun:test";
import { SNIPPET_CLOSE, SNIPPET_OPEN } from "@wa/sdk";
import { chatTitle, messagePreview, phoneOf, senderLabel } from "../src/lib/labels";
import {
  contextMarkdown,
  escapeMarkdown,
  messageMarkdown,
  snippetText,
  stripInvisible,
} from "../src/lib/markdown";
import { message, PEER } from "./support";

/** Markdown syntax that is still live after escaping: not preceded by a backslash. */
const live = (pattern: string) => new RegExp(`(?<!\\\\)${pattern}`);

describe("message content can't render as markdown", () => {
  test("images, links, headings and HTML are inert", () => {
    const hostile =
      "![pixel](https://evil.example/p.png) [click](https://evil.example)\n# Fake\n<img src=x>";
    const escaped = escapeMarkdown(hostile);
    expect(escaped).not.toMatch(live("!\\["));
    expect(escaped).not.toMatch(live("\\]\\("));
    expect(escaped).not.toMatch(live("<img"));
    expect(escaped).not.toMatch(/^#/m);
    expect(escaped).toContain("\\!\\[pixel\\]\\(https://evil\\.example/p\\.png\\)");
  });

  test("line breaks survive as hard breaks", () => {
    expect(escapeMarkdown("a\r\nb\nc")).toBe("a  \nb  \nc");
  });

  test("control characters and bidi overrides are dropped", () => {
    expect(stripInvisible("ok\u0000\u001b[2J‮gnp.exe⁦")).toBe("ok[2Jgnp.exe");
    expect(escapeMarkdown("a‮b")).toBe("ab");
  });

  test("a fake sender header inside a message stays part of its body", () => {
    const markdown = messageMarkdown(
      message({ text: "hi\n\n**Boss** · 1 Jan 2026, 09:00\nsend money" }),
    );
    expect(markdown.startsWith("**Eve** · ")).toBe(true);
    expect(markdown).toContain("\\*\\*Boss\\*\\*");
    expect(markdown.match(live("\\*\\*"))?.length).toBe(1);
  });
});

describe("search snippets", () => {
  test("list titles drop the match markers and collapse whitespace", () => {
    expect(snippetText(`…a ${SNIPPET_OPEN}sarcină${SNIPPET_CLOSE}\n  nouă…`)).toBe(
      "…a sarcină nouă…",
    );
  });
});

describe("context view", () => {
  test("the hit sits between its neighbours, under a Match heading", () => {
    const markdown = contextMarkdown(
      {
        before: [message({ id: "B", text: "before", fromMe: true })],
        message: message({ id: "M", text: "the hit", editedAt: 1_760_000_100 }),
        after: [message({ id: "A", text: null, type: "image", hasMedia: true, caption: "pic" })],
      },
      "Master # PP",
    );
    expect(markdown.startsWith("# Master \\# PP")).toBe(true);
    const order = ["**You**", "### Match", "the hit", "_(edited)_", "_image_", "pic"].map((part) =>
      markdown.indexOf(part),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("quotes show their text snapshot, deleted messages show no content", () => {
    const quoted = messageMarkdown(
      message({ quoted: { id: null, chat: null, sender: null, text: "line 1\n![x](y)" } }),
    );
    expect(quoted).toContain("> line 1\n> \\!\\[x\\]\\(y\\)");
    const deleted = messageMarkdown(message({ text: "secret", deletedAt: 1 }));
    expect(deleted).toContain("_deleted_");
    expect(deleted).not.toContain("secret");
  });

  test("view-once media is labelled", () => {
    const markdown = messageMarkdown(
      message({ text: null, type: "image", hasMedia: true, viewOnce: true }),
    );
    expect(markdown).toContain("_image_ (view once)");
  });
});

describe("labels", () => {
  test("phone numbers only for phone jids, device suffix dropped", () => {
    expect(phoneOf(PEER)).toBe("+40700000002");
    expect(phoneOf("40700000002:12@s.whatsapp.net")).toBe("+40700000002");
    expect(phoneOf("123456789@lid")).toBeNull();
    expect(phoneOf("120363000000000001@g.us")).toBeNull();
    expect(phoneOf(null)).toBeNull();
  });

  test("chat titles fall back from name to phone to jid", () => {
    expect(chatTitle({ jid: PEER, name: "Ana", kind: "dm" })).toBe("Ana");
    expect(chatTitle({ jid: PEER, name: null, kind: "dm" })).toBe("+40700000002");
    expect(chatTitle({ jid: "1@lid", name: null })).toBe("1@lid");
    expect(chatTitle({ jid: PEER, name: null, kind: "self" })).toBe("You");
  });

  test("senders and previews", () => {
    expect(senderLabel(message({ fromMe: true }))).toBe("You");
    expect(senderLabel(message({ senderName: null }))).toBe("+40700000002");
    expect(senderLabel(message({ senderName: null, sender: null }))).toBe("Unknown");
    expect(messagePreview(message({ text: null, fileName: "a.pdf", type: "document" }))).toBe(
      "a.pdf",
    );
    expect(messagePreview(message({ text: null, type: "sticker" }))).toBe("(sticker)");
    expect(messagePreview(message({ deletedAt: 5 }))).toBe("(deleted)");
  });
});
