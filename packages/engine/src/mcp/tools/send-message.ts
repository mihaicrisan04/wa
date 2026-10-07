import { z } from "zod";
import { can, type TokenPrincipal } from "../../policy";
import { chatNames, requiredText } from "../../queries";
import { MAX_TEXT, queueSend } from "../../send";
import { chatRef, quote } from "../format";
import { defineTool } from "../tool";

export const sendMessageTool = defineTool({
  name: "send_message",
  title: "Send a WhatsApp message",
  description: (principal: TokenPrincipal) =>
    can(principal, "send")
      ? 'Sends a text message to a chat this token can see (a jid, phone number or name), or to "self" for your own chat. It is queued and sent as soon as WhatsApp is connected.'
      : 'Sends a text message to your own chat: `to` must be "self". It is queued and sent as soon as WhatsApp is connected.',
  requires: ["send", "send:self"],
  readOnly: false,
  input: z.object({
    to: requiredText.describe('"self", or a chat jid, phone number or name'),
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
    const { chat, result } = await queueSend(
      env.deps.outbox,
      ctx,
      to,
      { kind: "text", text },
      "mcp",
    );
    const name = chatNames(ctx, [chat]).get(chat) ?? null;
    return {
      lines: [
        `queued for ${chatRef(chat, name)}: outbox ${quote(result.outboxId)}, message id ${quote(result.messageId)}, status ${result.status}`,
      ],
      structured: { ...result, chat },
      chat,
    };
  },
});
