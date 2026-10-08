import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaDownload } from "@wa/sdk";
import {
  cachedMediaPath,
  extensionFor,
  freePath,
  safeFileName,
  saveDownload,
} from "../src/lib/media-file";
import { PEER, tempDir } from "./support";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
});
afterEach(() => cleanup());

function download(body: ReadableStream<Uint8Array> | string): MediaDownload {
  return { response: new Response(body), mimetype: "image/jpeg", fileName: null, size: null };
}

describe("media file names", () => {
  test("extension from the file name, else from the mimetype", () => {
    expect(extensionFor("Report.PDF", "application/octet-stream")).toBe(".pdf");
    expect(extensionFor(null, "image/jpeg")).toBe(".jpg");
    expect(extensionFor(null, "audio/ogg; codecs=opus")).toBe(".ogg");
    expect(extensionFor("no-extension", null)).toBe(".bin");
    expect(extensionFor("weird.<script>", "video/mp4")).toBe(".mp4");
  });

  test("sender-chosen names can't escape the folder or hide as dotfiles", () => {
    expect(safeFileName("../../.ssh/authorized_keys", "x")).toBe("authorized_keys");
    expect(safeFileName("..\\..\\evil.txt", "x")).toBe("evil.txt");
    expect(safeFileName("a\u0000b\nc:d.txt", "x")).toBe("abcd.txt");
    expect(safeFileName(".zshrc", "fallback.bin")).toBe("fallback.bin");
    expect(safeFileName("..", "fallback.bin")).toBe("fallback.bin");
    expect(safeFileName(null, "fallback.bin")).toBe("fallback.bin");
  });

  test("cache paths are hashes: no message id or chat jid in the path", () => {
    const path = cachedMediaPath(dir, PEER, "3EB0SECRETID", ".jpg");
    expect(path.startsWith(dir)).toBe(true);
    expect(path).not.toContain("3EB0SECRETID");
    expect(path).not.toContain("40700000002");
    expect(path).toMatch(/[0-9a-f]{32}\.jpg$/);
    expect(cachedMediaPath(dir, PEER, "3EB0SECRETID", ".jpg")).toBe(path);
    expect(cachedMediaPath(dir, PEER, "OTHER", ".jpg")).not.toBe(path);
  });

  test("saving never overwrites an existing file", async () => {
    expect(await freePath(dir, "photo.jpg")).toBe(join(dir, "photo.jpg"));
    await writeFile(join(dir, "photo.jpg"), "");
    await writeFile(join(dir, "photo (1).jpg"), "");
    expect(await freePath(dir, "photo.jpg")).toBe(join(dir, "photo (2).jpg"));
  });
});

describe("saving a download", () => {
  test("streams the bytes into a private file, creating the folder", async () => {
    const path = join(dir, "cache", "a.jpg");
    await saveDownload(download("jpeg bytes"), path);
    expect(await readFile(path, "utf8")).toBe("jpeg bytes");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "cache"))).mode & 0o777).toBe(0o700);
  });

  test("an interrupted download leaves nothing that looks complete", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("half"));
        controller.error(new Error("engine went away"));
      },
    });
    const path = join(dir, "b.jpg");
    await expect(saveDownload(download(broken), path)).rejects.toThrow("engine went away");
    expect(await readdir(dir)).toEqual([]);
  });
});
