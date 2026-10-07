import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { MediaDownload } from "@wa/sdk";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "application/pdf": ".pdf",
};

/** From the file name when it has one, else from the mimetype (parameters like `; codecs` ignored). */
export function extensionFor(fileName: string | null, mimetype: string | null): string {
  const fromName = fileName ? extname(fileName).toLowerCase() : "";
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  const type = mimetype?.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXTENSIONS[type] ?? ".bin";
}

/** A sender-chosen name made safe to write: base name only, no control or path characters. */
export function safeFileName(name: string | null, fallback: string): string {
  const cleaned = [...basename((name ?? "").replaceAll("\\", "/"))]
    .filter((char) => char >= " " && char !== ":")
    .join("")
    .trim()
    .slice(0, 200);
  return cleaned && !cleaned.startsWith(".") ? cleaned : fallback;
}

/** Cache files are named by a hash so message ids and sender file names never reach paths. */
export function cachedMediaPath(dir: string, chat: string, id: string, extension: string): string {
  const hash = createHash("sha256").update(`${chat}\n${id}`).digest("hex").slice(0, 32);
  return join(dir, `${hash}${extension}`);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** `name.ext`, then `name (1).ext`, … until one is free. */
export async function freePath(dir: string, fileName: string): Promise<string> {
  const extension = extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  for (let copy = 0; ; copy++) {
    const candidate = join(dir, copy === 0 ? fileName : `${stem} (${copy})${extension}`);
    if (!(await exists(candidate))) return candidate;
  }
}

/** Streams the body to a partial file first, so an interrupted download never looks complete. */
export async function saveDownload(download: MediaDownload, path: string): Promise<void> {
  const body = download.response.body;
  if (!body) throw new Error("the engine sent no media bytes");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const partial = `${path}.part`;
  try {
    await pipeline(
      Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
      createWriteStream(partial, { mode: 0o600 }),
    );
    await rename(partial, path);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}
