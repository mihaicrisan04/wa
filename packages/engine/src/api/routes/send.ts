import { basename } from "node:path";
import type { OutboxEntry, Recipient, SendResult } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { invalid, notFound } from "../../errors";
import type { OutgoingMessage } from "../../outbox";
import { actorOf, assertCan, type Principal } from "../../policy";
import { inScope, listRecipients, sendTarget, type ReadContext } from "../../queries";
import type { OutboxPayload, OutboxRow } from "../../store";
import { readContext, type ApiDeps, type AppContext, type AppEnv } from "../context";
import { jsonBody, limitParam, optionalText, requiredText } from "../params";

const MAX_TEXT = 65_536;

const recipientsQuery = z.object({ q: optionalText, limit: limitParam(50, 500) });
const textBody = z.object({ to: requiredText, text: z.string().min(1).max(MAX_TEXT) });
const fileFields = z.object({
  to: requiredText,
  caption: z.string().max(MAX_TEXT).optional(),
});

export function sendRoutes(deps: ApiDeps) {
  return new Hono<AppEnv>()
    .get("/recipients", (c) => {
      assertCan(c.get("principal"), "send", "send:self");
      const query = recipientsQuery.parse(c.req.query());
      return c.json({ items: listRecipients(readContext(c, deps), query) satisfies Recipient[] });
    })
    .post("/send", async (c) => {
      const principal = c.get("principal");
      assertCan(principal, "send", "send:self");
      const { to, message } = await readSendRequest(c);
      const chatJid = sendTarget(readContext(c, deps), to);
      const row = await deps.outbox.enqueue(chatJid, message, actorOf(principal).profile);
      deps.store.audit.record({
        ...actorOf(principal),
        action: "send",
        chatJid,
        detail: { outboxId: row.id, kind: message.kind },
      });
      const result: SendResult = {
        outboxId: row.id,
        messageId: row.message_id,
        status: row.status,
      };
      return c.json(result, 202);
    })
    .get("/outbox/:id", (c) => {
      const principal = c.get("principal");
      assertCan(principal, "send", "send:self");
      const row = deps.store.outbox.get(c.req.param("id"));
      if (!row || !mayRead(readContext(c, deps), principal, row)) throw notFound();
      return c.json(toEntry(row) satisfies OutboxEntry);
    });
}

/** JSON `{ to, text }`, or multipart with `to`, an optional `caption` and the uploaded `file`. */
async function readSendRequest(c: AppContext): Promise<{ to: string; message: OutgoingMessage }> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    const body = await jsonBody(c, textBody);
    return { to: body.to, message: { kind: "text", text: body.text } };
  }
  const form = await c.req.formData().catch(() => {
    throw invalid("body: not valid multipart form data");
  });
  const fields = fileFields.parse({
    to: form.get("to") ?? undefined,
    caption: form.get("caption") || undefined,
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw invalid("file: an uploaded file is required");
  return {
    to: fields.to,
    message: {
      kind: "file",
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: safeFileName(file.name),
      mimetype: file.type || null,
      caption: fields.caption ?? null,
    },
  };
}

/** Only the base name of what the client called the file, and never empty. */
function safeFileName(name: string): string {
  const printable = [...name.replaceAll("\\", "/")].filter((char) => char >= " ").join("");
  const base = basename(printable).slice(0, 255);
  return base && base !== "." && base !== ".." ? base : "file";
}

/** An entry is visible to the profile that queued it, while its chat is still in scope. */
function mayRead(ctx: ReadContext, principal: Principal, row: OutboxRow): boolean {
  if (principal.kind === "admin") return true;
  const payload = JSON.parse(row.payload) as OutboxPayload;
  if (payload.profile !== principal.profile) return false;
  return row.chat_jid === ctx.identity.me() || inScope(ctx, row.chat_jid);
}

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    outboxId: row.id,
    messageId: row.message_id,
    chat: row.chat_jid,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
