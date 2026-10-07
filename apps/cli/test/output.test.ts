import { describe, expect, test } from "bun:test";
import { SNIPPET_CLOSE, SNIPPET_OPEN, type Message } from "@wa/sdk";
import { highlight, messageLine, who } from "../src/output";

const message: Message = {
  chat: "40700000002@s.whatsapp.net",
  id: "M1",
  fromMe: false,
  sender: "40700000002@s.whatsapp.net",
  senderName: "Eve",
  ts: 0,
  type: "text",
  text: null,
  caption: null,
  fileName: null,
  quoted: null,
  editedAt: null,
  deletedAt: null,
  expiresAt: null,
  hasMedia: false,
  viewOnce: false,
};

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

describe("terminal output of sender-controlled text", () => {
  test("a message can't redraw the line or emit escape sequences", () => {
    const line = messageLine({
      ...message,
      senderName: "Eve\u001b]52;c;aGk=\u0007",
      text: "hi\r[2026-01-01 00:00] me: forged\u001b[2K‮",
      quoted: { id: "Q", chat: null, sender: null, text: "q\u009b1A" },
    });
    expect(line).not.toMatch(CONTROL);
    expect(line).not.toContain("‮");
    expect(line).toContain("hi ⏎ [2026-01-01 00:00] me: forged");
    expect(line.split("\n")).toHaveLength(1);
  });

  test("names are sanitized wherever they are printed", () => {
    expect(who(null, "a\u001b[31mred")).toBe("a�[31mred");
  });

  test("search highlights keep their own escapes but not the snippet's", () => {
    const snippet = `x\u001b[2J ${SNIPPET_OPEN}term${SNIPPET_CLOSE}\ry`;
    expect(highlight(snippet, true)).toBe("x�[2J \u001b[1mterm\u001b[22m ⏎ y");
    expect(highlight(snippet)).toBe("x�[2J «term» ⏎ y");
  });
});
