import { BufferJSON, proto, type WAMessage, type WAMessageKey } from "@whiskeysockets/baileys";

/**
 * `raw` column codec. Protobuf would drop the key's alt fields (`remoteJidAlt`,
 * `participantAlt`, `addressingMode`), so the key is kept as a plain object; thumbnails are
 * stripped because they are large and re-derivable from the media.
 */
export function serializeRaw(message: WAMessage): string {
  const info = proto.WebMessageInfo.fromObject(message);
  const plain = proto.WebMessageInfo.toObject(info, { longs: String });
  plain.key = plainKey(message.key);
  return JSON.stringify(stripThumbnails(plain), BufferJSON.replacer);
}

export function parseRaw(raw: string): WAMessage {
  const plain = JSON.parse(raw, BufferJSON.reviver) as { key?: WAMessageKey };
  const info = proto.WebMessageInfo.fromObject(plain);
  return Object.assign(info, { key: { ...plain.key } });
}

function plainKey(key: WAMessageKey): WAMessageKey {
  return Object.fromEntries(
    Object.entries(key).filter(([, value]) => value !== null && value !== undefined),
  );
}

function stripThumbnails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripThumbnails);
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([field]) => field !== "jpegThumbnail")
      .map(([field, inner]) => [field, stripThumbnails(inner)]),
  );
}
