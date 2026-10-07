import {
  getContentType,
  normalizeMessageContent,
  prepareWAMessageMedia,
  proto,
  toNumber,
} from "@whiskeysockets/baileys";
import { Jimp, JimpMime } from "jimp";
import pino from "pino";
import { buildMessage, content } from "./testing/fixtures";
import { buildOutgoingContent } from "./whatsapp/outgoing";

export interface SelftestResult {
  name: string;
  ok: boolean;
  detail?: string;
}

type Check = { name: string; run: () => Promise<void> };

/**
 * Exercises the parts of Baileys and jimp that only break once bundled into the
 * compiled binary (dynamic imports, WASM, protobuf statics). Fully offline.
 */
export async function runSelftest(): Promise<SelftestResult[]> {
  const results: SelftestResult[] = [];
  for (const check of CHECKS) {
    try {
      await check.run();
      results.push({ name: check.name, ok: true });
    } catch (err) {
      results.push({
        name: check.name,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

const CHECKS: Check[] = [
  { name: "outgoing image is encrypted for upload", run: outgoingImage },
  { name: "fixture message decodes through Baileys", run: decodeFixture },
];

async function outgoingImage(): Promise<void> {
  const png = await new Jimp({ width: 64, height: 48, color: 0x3366ffff }).getBuffer(JimpMime.png);
  const outgoing = await buildOutgoingContent({ file: { bytes: png, name: "selftest.png" } });
  if (!("image" in outgoing)) throw new Error("PNG was not turned into an image message");

  const prepared = await prepareWAMessageMedia(outgoing, {
    upload: async () => ({ mediaUrl: "https://selftest.invalid/media", directPath: "/selftest" }),
    logger: pino({ level: "silent" }),
  });
  const image = prepared.imageMessage;
  assert(image?.mimetype === "image/jpeg", `expected image/jpeg, got ${image?.mimetype}`);
  assert(image.width === 64 && image.height === 48, "image dimensions were not kept");
  assert((image.jpegThumbnail?.length ?? 0) > 0, "thumbnail is missing");
  assert(
    image.mediaKey?.length === 32 && (image.fileEncSha256?.length ?? 0) > 0,
    "media was not encrypted",
  );
}

async function decodeFixture(): Promise<void> {
  const message = buildMessage({
    chat: "40700000001@s.whatsapp.net",
    ts: 1_700_000_000,
    message: content.ephemeral(content.extendedText("selftest")),
  });
  const bytes = proto.WebMessageInfo.encode(message).finish();
  const decoded = proto.WebMessageInfo.decode(bytes);
  const inner = normalizeMessageContent(decoded.message);
  assert(getContentType(inner ?? undefined) === "extendedTextMessage", "unexpected content type");
  assert(inner?.extendedTextMessage?.text === "selftest", "text did not survive the round trip");
  assert(
    toNumber(decoded.messageTimestamp) === 1_700_000_000,
    "timestamp did not survive the round trip",
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
