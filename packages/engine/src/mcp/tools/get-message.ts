import { z } from "zod";
import { chatName, getMessage, resolveChat } from "../../queries";
import { chatRef, messageLine } from "../format";
import { chatInput, chatRefSchema, messageSchema } from "../schemas";
import { defineTool } from "../tool";

export const getMessageTool = defineTool({
  name: "get_message",
  title: "Get a message",
  description: "One message by id, with up to `context` messages before and after it.",
  requires: ["messages:read"],
  input: z.object({
    chat: chatInput,
    message_id: z.string().trim().min(1),
    context: z.number().int().min(0).max(50).default(0).describe("messages on each side"),
  }),
  output: z.object({
    chat: chatRefSchema,
    message: messageSchema,
    before: z.array(messageSchema),
    after: z.array(messageSchema),
  }),
  run({ chat: ref, message_id, context }, env) {
    const ctx = env.read();
    const jid = resolveChat(ctx, ref);
    const found = getMessage(ctx, jid, message_id, context);
    const chat = { jid, name: chatName(ctx, jid) };
    return {
      lines: [
        `chat ${chatRef(jid, chat.name)}, oldest first; the requested message is marked "> ":`,
        ...found.before.map((m) => `  ${messageLine(m)}`),
        `> ${messageLine(found.message)}`,
        ...found.after.map((m) => `  ${messageLine(m)}`),
      ],
      structured: { chat, ...found },
      chat: jid,
      count: 1 + found.before.length + found.after.length,
    };
  },
});
