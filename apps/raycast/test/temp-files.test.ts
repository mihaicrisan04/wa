import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pruneStaleFiles, removeExtractedImages } from "../src/lib/temp-files";
import { tempDir } from "./support";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
});
afterEach(() => cleanup());

const MINUTE = 60_000;

async function fileAged(name: string, ageMs: number): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, "bytes");
  const at = new Date(Date.now() - ageMs);
  await utimes(path, at, at);
  return path;
}

describe("temp files", () => {
  test("pruning removes only files older than the limit", async () => {
    await fileAged("old.jpg", 11 * MINUTE);
    await fileAged("old.jpg.part", 30 * MINUTE);
    await fileAged("fresh.pdf", MINUTE);
    await mkdir(join(dir, "nested"));
    await pruneStaleFiles(dir, 10 * MINUTE);
    expect((await readdir(dir)).sort()).toEqual(["fresh.pdf", "nested"]);
  });

  test("pruning a folder that doesn't exist yet is fine", async () => {
    await pruneStaleFiles(join(dir, "missing"), MINUTE);
  });

  test("extracted pasteboard images are removed, the user's own files never", async () => {
    const image = await fileAged("1760000000000.png", 0);
    const own = await fileAged("report.pdf", 0);
    await removeExtractedImages([
      { type: "image", filePath: image },
      { type: "file", filePath: own },
      { type: "text", text: "hi" },
    ]);
    expect(await readdir(dir)).toEqual(["report.pdf"]);
  });
});
