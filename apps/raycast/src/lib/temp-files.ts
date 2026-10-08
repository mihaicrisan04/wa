import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClipboardContent } from "./clipboard-media";

/** Media opened in its default app: a short-lived copy, never a second message store. */
export const MEDIA_DIR = join(tmpdir(), "wa-raycast", "media");
export const MEDIA_TTL_MS = 10 * 60_000;

/** Pasteboard images extracted so they can be uploaded. */
export const CLIPBOARD_DIR = join(tmpdir(), "wa-raycast", "clipboard");
export const CLIPBOARD_TTL_MS = 60 * 60_000;

/** Removes files in `dir` last modified more than `maxAgeMs` ago; a missing dir is fine. */
export async function pruneStaleFiles(
  dir: string,
  maxAgeMs: number,
  now = Date.now(),
): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && now - info.mtimeMs > maxAgeMs) await rm(path, { force: true });
    }),
  );
}

/** The engine keeps its own copy of uploaded bytes, so extracted pasteboard images can go. */
export async function removeExtractedImages(contents: ClipboardContent[]): Promise<void> {
  await Promise.all(
    contents.map((content) =>
      content.type === "image" ? rm(content.filePath, { force: true }) : undefined,
    ),
  );
}
