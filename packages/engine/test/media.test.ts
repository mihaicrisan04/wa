import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { encryptedStream } from "@whiskeysockets/baileys";
import { buildMessage, content, keyOf, makeTempHome, type TempHome } from "../src/testing";
import { MediaCache, MediaUnavailableError } from "../src/whatsapp/media";
import { parseRaw } from "../src/whatsapp/raw";
import { ANA_PN, harness, silent, type Harness } from "./support/harness";

let h: Harness;
let temp: TempHome;
let media: MediaCache;
let online: boolean;

beforeEach(async () => {
  h = harness();
  temp = await makeTempHome();
  online = true;
  media = new MediaCache({
    store: h.store,
    home: temp.home,
    logger: silent,
    client: () => (online ? h.client : null),
  });
});

afterEach(async () => {
  h.close();
  await temp.cleanup();
});

const PLAINTEXT = Buffer.from("%PDF-1.4 synthetic fixture document\n".repeat(20));

/** A document whose bytes really are encrypted the way WhatsApp's CDN serves them. */
async function encryptedDocument(id: string) {
  const encrypted = await encryptedStream(PLAINTEXT, "document");
  const ciphertext = await readFile(encrypted.encFilePath);
  await rm(encrypted.encFilePath, { force: true });
  const message = buildMessage({
    chat: ANA_PN,
    id,
    message: {
      documentMessage: {
        mimetype: "application/pdf",
        fileName: "../../etc/passwd.pdf",
        url: "https://mmg.whatsapp.net/fixture",
        directPath: "/v/t62.fixture",
        mediaKey: encrypted.mediaKey,
        fileSha256: encrypted.fileSha256,
        fileEncSha256: encrypted.fileEncSha256,
        fileLength: encrypted.fileLength,
      },
    },
  });
  return { message, ciphertext };
}

/** The CDN: the original link has expired, the reuploaded one serves the bytes. */
function fakeCdn(ciphertext: Buffer) {
  const requests: string[] = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL | Request,
  ) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url);
    return url.endsWith("/v/t62.fixture-refreshed")
      ? new Response(ciphertext)
      : new Response(null, { status: 410 });
  }) as typeof fetch);
  return { requests, restore: () => spy.mockRestore() };
}

describe("cache naming", () => {
  test("hashes chat and id, never using remote names", () => {
    const path = media.pathFor(
      { chatJid: ANA_PN, id: "3EB0X" },
      { file_name: "../../evil.sh", mimetype: null },
    );
    expect(path.startsWith(join(temp.home, "media") + "/")).toBe(true);
    expect(path).toMatch(/\/[0-9a-f]{64}\.sh$/);
    expect(path).not.toContain("3EB0X");
    expect(path).not.toContain("evil");
  });

  test("falls back from the file name to the mimetype, then to bin", () => {
    const key = { chatJid: ANA_PN, id: "3EB0X" };
    expect(media.pathFor(key, { file_name: null, mimetype: "audio/ogg; codecs=opus" })).toEndWith(
      ".ogg",
    );
    expect(media.pathFor(key, { file_name: "noext", mimetype: "image/jpeg" })).toEndWith(".jpeg");
    expect(
      media.pathFor(key, {
        file_name: null,
        mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toEndWith(".bin");
  });
});

describe("downloads", () => {
  test("decrypts into the cache, reuploading an expired link and keeping the new raw", async () => {
    const { message, ciphertext } = await encryptedDocument("3EB0DOC");
    await h.emit({ "messages.upsert": { messages: [message], type: "notify" } });
    const cdn = fakeCdn(ciphertext);
    try {
      const cached = await media.get({ chatJid: ANA_PN, id: "3EB0DOC" });

      expect(cached).toMatchObject({
        kind: "document",
        mimetype: "application/pdf",
        size: PLAINTEXT.length,
      });
      expect(await readFile(cached.path)).toEqual(PLAINTEXT);
      expect(((await stat(cached.path)).mode & 0o777).toString(8)).toBe("600");
      expect(((await stat(media.dir)).mode & 0o777).toString(8)).toBe("700");
      expect(cdn.requests).toEqual([
        "https://mmg.whatsapp.net/v/t62.fixture",
        "https://mmg.whatsapp.net/v/t62.fixture-refreshed",
      ]);
      expect(h.client.mediaReuploads.map((m) => m.key.id)).toEqual(["3EB0DOC"]);

      const raw = parseRaw(h.store.messages.get(ANA_PN, "3EB0DOC")!.raw!);
      expect(raw.message?.documentMessage?.directPath).toBe("/v/t62.fixture-refreshed");
      expect(h.store.media.get({ chatJid: ANA_PN, id: "3EB0DOC" })).toMatchObject({
        local_path: cached.path,
        size: PLAINTEXT.length,
      });

      expect((await media.get({ chatJid: ANA_PN, id: "3EB0DOC" })).path).toBe(cached.path);
      expect(cdn.requests).toHaveLength(2);
    } finally {
      cdn.restore();
    }
  });

  test("concurrent requests share one download", async () => {
    const { message, ciphertext } = await encryptedDocument("3EB0TWICE");
    await h.emit({ "messages.upsert": { messages: [message], type: "notify" } });
    const cdn = fakeCdn(ciphertext);
    try {
      const key = { chatJid: ANA_PN, id: "3EB0TWICE" };
      const [first, second] = await Promise.all([media.get(key), media.get(key)]);
      expect(first.path).toBe(second.path);
      expect(h.client.mediaReuploads).toHaveLength(1);
    } finally {
      cdn.restore();
    }
  });

  test("deleting the message removes the cached file", async () => {
    const { message, ciphertext } = await encryptedDocument("3EB0BYE");
    await h.emit({ "messages.upsert": { messages: [message], type: "notify" } });
    const cdn = fakeCdn(ciphertext);
    let path: string;
    try {
      path = (await media.get({ chatJid: ANA_PN, id: "3EB0BYE" })).path;
    } finally {
      cdn.restore();
    }
    await h.emit({ "messages.delete": { keys: [keyOf(message)] } });
    expect(await stat(path).catch(() => null)).toBeNull();
  });
});

describe("refusals", () => {
  async function reason(id: string): Promise<string> {
    const error = await media.get({ chatJid: ANA_PN, id }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MediaUnavailableError);
    return (error as MediaUnavailableError).reason;
  }

  test("view-once media is never downloaded", async () => {
    await h.emit({
      "messages.upsert": {
        messages: [
          buildMessage({
            chat: ANA_PN,
            id: "3EB0ONCE",
            message: content.viewOnce(content.image()),
          }),
        ],
        type: "notify",
      },
    });
    expect(await reason("3EB0ONCE")).toBe("view_once");
  });

  test("unknown messages, text messages and offline downloads", async () => {
    await h.emit({
      "messages.upsert": {
        messages: [
          buildMessage({ chat: ANA_PN, id: "3EB0TEXT", message: content.text("no media") }),
          buildMessage({ chat: ANA_PN, id: "3EB0IMG", message: content.image() }),
        ],
        type: "notify",
      },
    });
    expect(await reason("3EB0NOPE")).toBe("not_found");
    expect(await reason("3EB0TEXT")).toBe("not_media");
    online = false;
    expect(await reason("3EB0IMG")).toBe("offline");
  });
});
