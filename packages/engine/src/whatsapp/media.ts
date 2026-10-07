import { createHash } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { MediaKind } from "@wa/sdk";
import { downloadMediaMessage, type WAMessage } from "@whiskeysockets/baileys";
import { nowSeconds } from "../clock";
import { mediaDir } from "../config";
import { writeFileAtomic } from "../fs";
import { baileysLogger, type Logger } from "../logger";
import type { MediaRow, MessageKeyRef, MessageRow, Store } from "../store";
import { boomStatus } from "./boom";
import type { WhatsAppClient } from "./client";
import { parseRaw, serializeRaw } from "./raw";

export type MediaUnavailableReason = "not_found" | "not_media" | "view_once" | "offline";

export class MediaUnavailableError extends Error {
  constructor(readonly reason: MediaUnavailableReason) {
    super(`media unavailable: ${reason}`);
  }
}

export interface CachedMedia {
  path: string;
  kind: MediaKind;
  mimetype: string | null;
  fileName: string | null;
  size: number;
}

export interface MediaCacheOptions {
  store: Store;
  /** `WA_HOME`; files live in `WA_HOME/media`. */
  home: string;
  logger: Logger;
  /** The connected socket, null while offline. */
  client: () => WhatsAppClient | null;
  /** Baileys' downloader; replaceable in tests. */
  download?: typeof downloadMediaMessage;
}

const REUPLOAD_STATUSES = [404, 410];

/** Downloads media on demand into `WA_HOME/media/<sha256(chat:id)>.<ext>` and remembers it. */
export class MediaCache {
  readonly dir: string;
  private readonly inFlight = new Map<string, Promise<CachedMedia>>();

  constructor(private readonly options: MediaCacheOptions) {
    this.dir = mediaDir(options.home);
  }

  /** Never derived from remote names or raw ids, so nothing a sender controls reaches the path. */
  pathFor(key: MessageKeyRef, media: Pick<MediaRow, "file_name" | "mimetype">): string {
    const hash = createHash("sha256").update(`${key.chatJid}:${key.id}`).digest("hex");
    return join(this.dir, `${hash}.${extensionFor(media)}`);
  }

  get(key: MessageKeyRef): Promise<CachedMedia> {
    const id = `${key.chatJid}:${key.id}`;
    const pending = this.inFlight.get(id);
    if (pending) return pending;
    const download = this.load(key).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, download);
    return download;
  }

  private async load(key: MessageKeyRef): Promise<CachedMedia> {
    const { store } = this.options;
    const row = store.messages.get(key);
    if (!row || isGone(row)) throw new MediaUnavailableError("not_found");
    if (row.view_once) throw new MediaUnavailableError("view_once");
    const media = store.media.get(key);
    if (!media || !row.raw) throw new MediaUnavailableError("not_media");

    if (media.local_path) {
      const cached = await stat(media.local_path).catch(() => null);
      if (cached?.isFile()) return describe(media, media.local_path, cached.size);
    }
    const client = this.options.client();
    if (!client) throw new MediaUnavailableError("offline");

    const stream = await this.download(key, parseRaw(row.raw), client);
    const path = this.pathFor(key, media);
    await writeFileAtomic(path, stream);
    const { size } = await stat(path);
    if (!store.media.markDownloaded(key, path, size)) {
      await rm(path, { force: true });
      throw new MediaUnavailableError("not_found");
    }
    return describe(media, path, size);
  }

  /** Expired media links are refreshed by asking the phone to reupload; the new raw is kept. */
  private async download(key: MessageKeyRef, message: WAMessage, client: WhatsAppClient) {
    const download = this.options.download ?? downloadMediaMessage;
    let reuploaded = false;
    const reuploadRequest = async (stale: WAMessage): Promise<WAMessage> => {
      reuploaded = true;
      const updated = await client.updateMediaMessage(stale);
      this.options.store.messages.updateRaw(key, serializeRaw(updated));
      return updated;
    };
    const ctx = { reuploadRequest, logger: baileysLogger(this.options.logger) };
    try {
      return await download(message, "stream", {}, ctx);
    } catch (err) {
      if (reuploaded || !REUPLOAD_STATUSES.includes(boomStatus(err) ?? 0)) throw err;
      // rc14 only reuploads on `error.status`, which its Boom errors never set
      return await download(await reuploadRequest(message), "stream", {}, ctx);
    }
  }
}

/** Revoked, or a disappearing message past its expiry that the purge has not reached yet. */
function isGone(row: MessageRow): boolean {
  return row.deleted_at !== null || (row.expires_at !== null && row.expires_at <= nowSeconds());
}

function describe(media: MediaRow, path: string, size: number): CachedMedia {
  return { path, kind: media.kind, mimetype: media.mimetype, fileName: media.file_name, size };
}

const SAFE_EXTENSION = /^[a-z0-9]{1,10}$/;

function extensionFor({ file_name, mimetype }: Pick<MediaRow, "file_name" | "mimetype">): string {
  const fromName = file_name ? extname(file_name).slice(1).toLowerCase() : "";
  if (SAFE_EXTENSION.test(fromName)) return fromName;
  const fromMime = mimetype?.split(";")[0]?.split("/")[1]?.trim().toLowerCase() ?? "";
  return SAFE_EXTENSION.test(fromMime) ? fromMime : "bin";
}
