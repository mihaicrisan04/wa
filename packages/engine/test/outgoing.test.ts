import { describe, expect, test } from "bun:test";
import { Jimp, JimpMime } from "jimp";
import { buildOutgoingContent, classifyFile, mimetypeFor } from "../src/whatsapp/outgoing";

async function png(width: number, height: number): Promise<Buffer> {
  return new Jimp({ width, height, color: 0xff8800ff }).getBuffer(JimpMime.png);
}

describe("buildOutgoingContent", () => {
  test("text stays text", async () => {
    expect(await buildOutgoingContent({ text: "hi" })).toEqual({ text: "hi" });
  });

  test("images become JPEG with thumbnail and dimensions", async () => {
    const result = await buildOutgoingContent({
      file: { bytes: await png(320, 200), name: "shot.png" },
      caption: "look",
    });
    if (!("image" in result)) throw new Error("expected an image message");
    expect(result).toMatchObject({
      mimetype: "image/jpeg",
      width: 320,
      height: 200,
      caption: "look",
    });

    const jpeg = await Jimp.read(Buffer.from(result.image as Buffer));
    expect(jpeg.mime).toBe("image/jpeg");
    const thumbnail = await Jimp.read(Buffer.from(result.jpegThumbnail!, "base64"));
    expect(thumbnail.width).toBe(100);
    expect(thumbnail.height).toBe(63);
  });

  test("oversized images are scaled down to 4096px", async () => {
    const result = await buildOutgoingContent({
      file: { bytes: await png(8192, 16), name: "wide.PNG" },
    });
    expect(result).toMatchObject({ width: 4096, height: 8 });
  });

  test("videos, audio and documents keep their bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(
      await buildOutgoingContent({ file: { bytes, name: "clip.mov" }, caption: "c" }),
    ).toMatchObject({
      video: Buffer.from(bytes),
      mimetype: "video/quicktime",
      caption: "c",
    });
    expect(await buildOutgoingContent({ file: { bytes, name: "voice.opus" } })).toMatchObject({
      audio: Buffer.from(bytes),
      mimetype: "audio/opus",
    });
    expect(
      await buildOutgoingContent({ file: { bytes, name: "tema 2.pdf" }, caption: "c" }),
    ).toMatchObject({
      document: Buffer.from(bytes),
      mimetype: "application/pdf",
      fileName: "tema 2.pdf",
      caption: "c",
    });
  });
});

describe("file classification", () => {
  test.each([
    ["a.jpg", "image"],
    ["a.webp", "image"],
    ["a.MP4", "video"],
    ["a.m4a", "audio"],
    ["a.zip", "document"],
    ["no-extension", "document"],
  ] as const)("%s is %s", (name, kind) => {
    expect(classifyFile(name)).toBe(kind);
  });

  test("an uploaded mimetype wins over the extension, unknown falls back", () => {
    expect(
      mimetypeFor({ bytes: new Uint8Array(), name: "a.bin", mimetype: "text/csv" }, "x/y"),
    ).toBe("text/csv");
    expect(
      mimetypeFor({ bytes: new Uint8Array(), name: "a.bin" }, "application/octet-stream"),
    ).toBe("application/octet-stream");
  });
});
