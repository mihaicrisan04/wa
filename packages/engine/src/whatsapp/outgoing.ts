import { extname } from "node:path";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { Jimp, JimpMime } from "jimp";

/** What a client asks to send; a file's bytes travel apart (the outbox keeps them on disk). */
export type OutgoingContent =
  | { kind: "text"; text: string }
  | { kind: "file"; fileName: string; mimetype: string | null; caption: string | null };

type OutgoingFile = Extract<OutgoingContent, { kind: "file" }>;

export type OutgoingMessage =
  | Extract<OutgoingContent, { kind: "text" }>
  | (OutgoingFile & { bytes: Uint8Array });

const MAX_IMAGE_DIMENSION = 4096;
const THUMBNAIL_WIDTH = 100;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".3gp": "video/3gpp",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".opus": "audio/opus",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".txt": "text/plain",
};

type OutgoingKind = "image" | "video" | "audio" | "document";

const KIND_BY_MIME_TYPE: Record<string, OutgoingKind> = {
  image: "image",
  video: "video",
  audio: "audio",
};

export function classifyFile(name: string): OutgoingKind {
  const mimeType = MIME_BY_EXTENSION[extname(name).toLowerCase()]?.split("/")[0] ?? "";
  return KIND_BY_MIME_TYPE[mimeType] ?? "document";
}

export function mimetypeFor(
  file: Pick<OutgoingFile, "fileName" | "mimetype">,
  fallback: string,
): string {
  return file.mimetype || MIME_BY_EXTENSION[extname(file.fileName).toLowerCase()] || fallback;
}

export async function buildOutgoingContent(message: OutgoingMessage): Promise<AnyMessageContent> {
  if (message.kind === "text") return { text: message.text };

  const bytes = Buffer.from(message.bytes);
  const caption = message.caption ?? undefined;
  switch (classifyFile(message.fileName)) {
    case "image":
      return { ...(await prepareImage(bytes)), caption };
    case "video":
      return { video: bytes, mimetype: mimetypeFor(message, "video/mp4"), caption };
    case "audio":
      return { audio: bytes, mimetype: mimetypeFor(message, "audio/mpeg") };
    case "document":
      return {
        document: bytes,
        mimetype: mimetypeFor(message, "application/octet-stream"),
        fileName: message.fileName,
        caption,
      };
  }
}

/**
 * WhatsApp treats large PNGs as documents, so every image is sent as JPEG. The thumbnail
 * and dimensions are always set because Baileys' own sharp/jimp fallbacks don't load in
 * the compiled binary.
 */
async function prepareImage(bytes: Buffer) {
  const image = await Jimp.read(bytes);
  if (image.width > MAX_IMAGE_DIMENSION || image.height > MAX_IMAGE_DIMENSION) {
    const scale = MAX_IMAGE_DIMENSION / Math.max(image.width, image.height);
    image.resize({ w: Math.round(image.width * scale), h: Math.round(image.height * scale) });
  }
  const jpeg = await image.getBuffer(JimpMime.jpeg, { quality: 85 });
  const thumbnail = image.clone().resize({ w: THUMBNAIL_WIDTH });
  const jpegThumbnail = await thumbnail.getBuffer(JimpMime.jpeg, { quality: 50 });

  return {
    image: jpeg,
    mimetype: JimpMime.jpeg,
    jpegThumbnail: jpegThumbnail.toString("base64"),
    width: image.width,
    height: image.height,
  };
}
