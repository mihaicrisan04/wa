import { z } from "zod";
import { actorOf, can, type Principal } from "../../policy";
import { chatName, sendTarget } from "../../queries";
import { chatRef, quote } from "../format";
import { defineTool } from "../tool";

const MAX_TEXT = 65_536;

export const sendMessageTool = defineTool({
  name: "send_message",
  title: "Send a WhatsApp message",
  description: (principal: Principal) =>
    can(principal, "send")
      ? 'Sends a text message to a chat this token can see (a jid, phone number or name), or to "self" for your own chat. It is queued and sent as soon as WhatsApp is connected.'
      : 'Sends a text message to your own chat: `to` must be "self". It is queued and sent as soon as WhatsApp is connected.',
  requires: ["send", "send:self"],
  readOnly: false,
  input: z.object({
    to: z.string().trim().min(1).describe('"self", or a chat jid, phone number or name'),
    text: z.string().min(1).max(MAX_TEXT),
  }),
  output: z.object({
    outboxId: z.string(),
    messageId: z.string(),
    chat: z.string(),
    status: z.string(),
  }),
  async run({ to, text }, env) {
    const ctx = env.read();
    const chatJid = sendTarget(ctx, to);
    const { profile } = actorOf(env.principal);
    const row = await env.deps.outbox.enqueue(chatJid, { kind: "text", text }, profile);
    env.deps.store.audit.record({
      ...actorOf(env.principal),
      action: "send",
      chatJid,
      detail: { outboxId: row.id, kind: "text", via: "mcp" },
    });
    return {
      lines: [
        `queued for ${chatRef(chatJid, chatName(ctx, chatJid))}: outbox ${quote(row.id)}, message id ${quote(row.message_id)}, status ${row.status}`,
      ],
      structured: {
        outboxId: row.id,
        messageId: row.message_id,
        chat: chatJid,
        status: row.status,
      },
      chat: chatJid,
    };
  },
});
