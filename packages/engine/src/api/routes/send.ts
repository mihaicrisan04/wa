import { basename } from "node:path";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_TOO_LARGE,
  type OutboxEntry,
  type Recipient,
  type SendResult,
} from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { invalid, tooLarge } from "../../errors";
import { getOutboxEntry, listRecipients, recipientsQuery, requiredText } from "../../queries";
import { MAX_TEXT, queueSend } from "../../send";
import type { OutgoingMessage } from "../../whatsapp/outgoing";
import { requires } from "../auth";
import { readContext, type ApiDeps, type AppContext, type AppEnv } from "../context";
import { jsonBody } from "../params";

const textBody = z.object({ to: requiredText, text: z.string().min(1).max(MAX_TEXT) });
const fileFields = z.object({
  to: requiredText,
  caption: z.string().max(MAX_TEXT).optional(),
});

const sender = requires("send", "send:self");

export function sendRoutes(deps: ApiDeps) {
  return new Hono<AppEnv>()
    .get("/recipients", sender, (c) => {
      const query = recipientsQuery.parse(c.req.query());
      const items = listRecipients(readContext(deps, c.get("principal")), query);
      return c.json({ items: items satisfies Recipient[] });
    })
    .post("/send", sender, async (c) => {
      const { to, message } = await readSendRequest(c);
      const ctx = readContext(deps, c.get("principal"));
      const { result } = await queueSend(deps.outbox, ctx, to, message);
      return c.json(result satisfies SendResult, 202);
    })
    .get("/outbox/:id", sender, (c) => {
      const ctx = readContext(deps, c.get("principal"));
      return c.json(getOutboxEntry(ctx, c.req.param("id")) satisfies OutboxEntry);
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
  if (file.size > MAX_UPLOAD_BYTES) throw tooLarge(UPLOAD_TOO_LARGE);
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
