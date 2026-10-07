import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadMediaMessage, type WAMessage } from "@whiskeysockets/baileys";
import { baileysLogger, type Logger } from "../logger";
import type { MediaRow, MessageKeyRef, Store } from "../store";
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
  kind: string;
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
    this.dir = join(options.home, "media");
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
    const row = store.messages.get(key.chatJid, key.id);
    if (!row || row.deleted_at !== null) throw new MediaUnavailableError("not_found");
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
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const partial = `${path}.${randomUUID()}.part`;
    try {
      await pipeline(stream, createWriteStream(partial, { mode: 0o600 }));
      await rename(partial, path);
    } catch (err) {
      await rm(partial, { force: true });
      throw err;
    }
    const { size } = await stat(path);
    store.media.markDownloaded(key, path, size);
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
      return (await download(message, "stream", {}, ctx)) as Readable;
    } catch (err) {
      if (reuploaded || !REUPLOAD_STATUSES.includes(httpStatusOf(err))) throw err;
      // rc14 only reuploads on `error.status`, which its Boom errors never set
      return (await download(await reuploadRequest(message), "stream", {}, ctx)) as Readable;
    }
  }
}

export async function removeCachedFiles(paths: string[], logger: Logger): Promise<void> {
  await Promise.all(
    paths.map((path) =>
      rm(path, { force: true }).catch((err: unknown) => {
        logger.warn({ err }, "could not remove a cached media file");
      }),
    ),
  );
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

function httpStatusOf(err: unknown): number {
  const error = err as { status?: unknown; output?: { statusCode?: unknown } } | null;
  const status = error?.output?.statusCode ?? error?.status;
  return typeof status === "number" ? status : 0;
}
