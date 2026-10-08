import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CLIPBOARD_DIR, CLIPBOARD_TTL_MS, pruneStaleFiles } from "./temp-files";

export type ClipboardContent =
  | { type: "text"; text: string }
  | { type: "url"; url: string }
  | { type: "file"; filePath: string }
  | { type: "image"; filePath: string }
  | { type: "empty" };

/** Writes the pasteboard image (any type NSImage reads) to the PNG path given as its argument. */
const SAVE_PASTEBOARD_PNG = `
import AppKit
let pb = NSPasteboard.general
guard let img = NSImage(pasteboard: pb) else { print("none"); exit(0) }
guard let tiff = img.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:])
else { print("none"); exit(0) }
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
print("ok")
`;

function saveClipboardImage(): string | null {
  // whatever a closed or crashed command left behind
  void pruneStaleFiles(CLIPBOARD_DIR, CLIPBOARD_TTL_MS);
  const tempPath = join(CLIPBOARD_DIR, `${Date.now()}.png`);
  try {
    mkdirSync(CLIPBOARD_DIR, { recursive: true, mode: 0o700 });
    const result = execFileSync("swift", ["-e", SAVE_PASTEBOARD_PNG, tempPath], {
      timeout: 10_000,
    })
      .toString()
      .trim();

    if (result === "ok" && existsSync(tempPath) && statSync(tempPath).size > 0) {
      return tempPath;
    }
  } catch {
    // swift failed or timed out: treated like no image
  }
  return null;
}

/** Apps like Shottr put "Image (1896x1226)" next to the image itself. */
function looksLikeClipboardMeta(text: string): boolean {
  return /^Image\s*\(\d+[x×]\d+\)$/i.test(text.trim());
}

function fileUrlToPath(fileUrl: string): string {
  if (fileUrl.startsWith("file://")) {
    return decodeURIComponent(new URL(fileUrl).pathname);
  }
  return fileUrl;
}

/**
 * `pasteboardImage: false` for clipboard history entries: the image fallback reads the live
 * pasteboard, which belongs to the current entry only.
 */
export function readClipboard(
  text?: string,
  file?: string,
  { pasteboardImage = true }: { pasteboardImage?: boolean } = {},
): ClipboardContent {
  // before the file field: Shottr's temp file has no extension, so the engine can't type it
  if (pasteboardImage && text && looksLikeClipboardMeta(text)) {
    const imagePath = saveClipboardImage();
    if (imagePath) {
      return { type: "image", filePath: imagePath };
    }
  }

  if (file) {
    const filePath = fileUrlToPath(file);
    if (existsSync(filePath)) {
      return { type: "file", filePath };
    }
  }

  if (!text) {
    const imagePath = pasteboardImage ? saveClipboardImage() : null;
    if (imagePath) {
      return { type: "image", filePath: imagePath };
    }
    return { type: "empty" };
  }

  const urlPattern = /^https?:\/\/[^\s]+$/;
  if (urlPattern.test(text.trim())) {
    return { type: "url", url: text.trim() };
  }

  return { type: "text", text };
}

export function describeContent(content: ClipboardContent): string {
  switch (content.type) {
    case "url":
      return content.url;
    case "text":
      return content.text.length > 60 ? content.text.slice(0, 60) + "..." : content.text;
    case "file":
      return content.filePath.split("/").pop() || "file";
    case "image":
      return "clipboard image";
    case "empty":
      return "";
  }
}
