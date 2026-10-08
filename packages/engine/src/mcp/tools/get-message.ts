import { z } from "zod";
import { chatRefOf, contextParam, getMessage, requiredText } from "../../queries";
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
    message_id: requiredText,
    context: contextParam.describe("messages on each side"),
  }),
  output: z.object({
    chat: chatRefSchema,
    message: messageSchema,
    before: z.array(messageSchema),
    after: z.array(messageSchema),
  }),
  run({ chat: ref, message_id, context }, env) {
    const ctx = env.read();
    const chat = chatRefOf(ctx, ref);
    const found = getMessage(ctx, chat.jid, message_id, context);
    return {
      lines: [
        `chat ${chatRef(chat.jid, chat.name)}, oldest first; the requested message is marked "> ":`,
        ...found.before.map((m) => `  ${messageLine(m)}`),
        `> ${messageLine(found.message)}`,
        ...found.after.map((m) => `  ${messageLine(m)}`),
      ],
      structured: { chat, ...found },
      chat: chat.jid,
      count: 1 + found.before.length + found.after.length,
    };
  },
});
