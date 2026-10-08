import type { Context } from "hono";
import type { Backfills } from "../backfill";
import { Identity } from "../ingest";
import type { Logger } from "../logger";
import type { Outbox } from "../outbox";
import type { Principal } from "../policy";
import type { ReadContext } from "../queries";
import type { Store } from "../store";
import type { WhatsAppConnection } from "../whatsapp/connection";
import type { MediaCache } from "../whatsapp/media";

/** What the routes work with. */
export interface ApiDeps {
  version: string;
  logger: Logger;
  store: Store;
  connection: WhatsAppConnection;
  media: MediaCache;
  outbox: Outbox;
  backfills: Backfills;
  /** Where MCP `download_media` exports files; `$TMPDIR/wa-export` by default. */
  exportDir?: string;
  /** Lifts the server's idle timeout for a long response (media downloads). */
  noTimeout?: (request: Request) => void;
}

export type AppEnv = { Variables: { principal: Principal } };

export type AppContext = Context<AppEnv>;

/** The scoped read context of the request: built per request, so nothing is cached. */
export function readContext(c: AppContext, deps: ApiDeps): ReadContext {
  return {
    store: deps.store,
    principal: c.get("principal"),
    identity: new Identity(deps.store, deps.connection.me()),
  };
}
