import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ClipboardContent =
  | { type: "text"; text: string }
  | { type: "url"; url: string }
  | { type: "file"; filePath: string }
  | { type: "image"; filePath: string }
  | { type: "empty" };

/**
 * Extract clipboard image data to a temp PNG file via Swift.
 * Handles public.png, public.tiff, and other NSImage-compatible pasteboard types.
 */
function saveClipboardImage(): string | null {
  const tempPath = join(tmpdir(), `whatsapp-clipboard-${Date.now()}.png`);
  try {
    const result = execSync(
      `swift -e '
import AppKit
let pb = NSPasteboard.general
guard let img = NSImage(pasteboard: pb) else { print("none"); exit(0) }
guard let tiff = img.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:])
else { print("none"); exit(0) }
try png.write(to: URL(fileURLWithPath: "${tempPath}"))
print("ok")
'`,
      { timeout: 10000 },
    )
      .toString()
      .trim();

    if (result === "ok" && existsSync(tempPath) && statSync(tempPath).size > 0) {
      return tempPath;
    }
  } catch {
    // no image on clipboard
  }
  return null;
}

/**
 * Check if text looks like clipboard metadata rather than real content.
 * Apps like Shottr put "Image (1896x1226)" alongside the actual image data.
 */
function looksLikeClipboardMeta(text: string): boolean {
  return /^Image\s*\(\d+[x×]\d+\)$/i.test(text.trim());
}

function fileUrlToPath(fileUrl: string): string {
  if (fileUrl.startsWith("file://")) {
    return decodeURIComponent(new URL(fileUrl).pathname);
  }
  return fileUrl;
}

export function readClipboard(text?: string, file?: string): ClipboardContent {
  // if text looks like clipboard metadata (e.g. Shottr's "Image (1688x1085)"),
  // extract the actual image via Swift before checking the file field —
  // Shottr puts a temp file with no extension which the daemon can't type-detect
  if (text && looksLikeClipboardMeta(text)) {
    const imagePath = saveClipboardImage();
    if (imagePath) {
      return { type: "image", filePath: imagePath };
    }
  }

  // file copied from Finder
  if (file) {
    const filePath = fileUrlToPath(file);
    if (existsSync(filePath)) {
      return { type: "file", filePath };
    }
  }

  // try image extraction if there's no text at all
  if (!text) {
    const imagePath = saveClipboardImage();
    if (imagePath) {
      return { type: "image", filePath: imagePath };
    }
    return { type: "empty" };
  }

  // real text content
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
