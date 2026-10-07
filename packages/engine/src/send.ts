import type { SendResult } from "@wa/sdk";
import type { Outbox } from "./outbox";
import { recordAudit } from "./policy";
import { sendTarget, type ReadContext } from "./queries";
import type { OutgoingMessage } from "./whatsapp/outgoing";

/** The longest text or caption the engine queues. */
export const MAX_TEXT = 65_536;

export interface QueuedSend {
  /** The canonical jid `to` named. */
  chat: string;
  result: SendResult;
}

/** Queues `message` for the chat `to` names and audits it; it goes out once WhatsApp is open. */
export async function queueSend(
  outbox: Outbox,
  ctx: ReadContext,
  to: string,
  message: OutgoingMessage,
  via?: "mcp",
): Promise<QueuedSend> {
  const { principal } = ctx;
  const chat = sendTarget(ctx, to);
  const row = await outbox.enqueue(
    chat,
    message,
    principal.kind === "token" ? principal.profile : null,
  );
  recordAudit(ctx.store, principal, "send", {
    chatJid: chat,
    detail: { outboxId: row.id, kind: message.kind, ...(via && { via }) },
  });
  return { chat, result: { outboxId: row.id, messageId: row.message_id, status: row.status } };
}
