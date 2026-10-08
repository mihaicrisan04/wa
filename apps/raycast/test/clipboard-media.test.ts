import { describe, expect, test } from "bun:test";
import { describeContent, readClipboard } from "../src/lib/clipboard-media";

const historyEntry = { pasteboardImage: false };

describe("clipboard content", () => {
  test("a lone http(s) URL is a link, anything else is text", () => {
    expect(readClipboard("  https://example.com/a?b=1 ", undefined, historyEntry)).toEqual({
      type: "url",
      url: "https://example.com/a?b=1",
    });
    expect(readClipboard("see https://example.com", undefined, historyEntry)).toEqual({
      type: "text",
      text: "see https://example.com",
    });
  });

  test("a file URL that no longer exists falls back to the text", () => {
    expect(readClipboard("name.txt", "file:///nonexistent/wa/name.txt", historyEntry)).toEqual({
      type: "text",
      text: "name.txt",
    });
  });

  test("history entries never read the live pasteboard image", () => {
    expect(readClipboard(undefined, undefined, historyEntry)).toEqual({ type: "empty" });
    expect(readClipboard("Image (1688x1085)", undefined, historyEntry)).toEqual({
      type: "text",
      text: "Image (1688x1085)",
    });
  });

  test("descriptions are short", () => {
    expect(describeContent({ type: "text", text: "x".repeat(100) })).toBe(`${"x".repeat(60)}...`);
    expect(describeContent({ type: "file", filePath: "/a/b/report.pdf" })).toBe("report.pdf");
    expect(describeContent({ type: "image", filePath: "/tmp/x.png" })).toBe("clipboard image");
  });
});
