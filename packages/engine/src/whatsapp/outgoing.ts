import { extname } from "node:path";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { Jimp, JimpMime } from "jimp";

export interface OutgoingFile {
  bytes: Uint8Array;
  name: string;
  mimetype?: string;
}

export type OutgoingPayload = { text: string } | { file: OutgoingFile; caption?: string };

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

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".3gp"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".ogg", ".m4a", ".wav", ".aac", ".opus"]);

export type OutgoingKind = "image" | "video" | "audio" | "document";

export function classifyFile(name: string): OutgoingKind {
  const extension = extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return "document";
}

export function mimetypeFor(file: OutgoingFile, fallback: string): string {
  return file.mimetype || MIME_BY_EXTENSION[extname(file.name).toLowerCase()] || fallback;
}

export async function buildOutgoingContent(payload: OutgoingPayload): Promise<AnyMessageContent> {
  if ("text" in payload) return { text: payload.text };

  const { file, caption } = payload;
  const bytes = Buffer.from(file.bytes);
  switch (classifyFile(file.name)) {
    case "image":
      return { ...(await prepareImage(bytes)), caption };
    case "video":
      return { video: bytes, mimetype: mimetypeFor(file, "video/mp4"), caption };
    case "audio":
      return { audio: bytes, mimetype: mimetypeFor(file, "audio/mpeg") };
    case "document":
      return {
        document: bytes,
        mimetype: mimetypeFor(file, "application/octet-stream"),
        fileName: file.name,
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
