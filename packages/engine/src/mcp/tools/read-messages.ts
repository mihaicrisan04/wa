import { z } from "zod";
import { chatRefOf, limitParam, listMessages, requiredText } from "../../queries";
import { chatRef, messageLine, quote } from "../format";
import { chatInput, chatRefSchema, messageSchema, timeInput } from "../schemas";
import { defineTool } from "../tool";

export const readMessagesTool = defineTool({
  name: "read_messages",
  title: "Read a chat",
  description:
    "Messages of one chat, oldest first: the latest ones by default, or before/after a time or a cursor from an earlier call, or around a message id.",
  requires: ["messages:read"],
  input: z.object({
    chat: chatInput,
    before: timeInput.optional().describe("older than this: unix seconds, an ISO date or a cursor"),
    after: timeInput.optional().describe("newer than this: unix seconds, an ISO date or a cursor"),
    around_message_id: requiredText.optional().describe("center on this message"),
    limit: limitParam(50, 200),
  }),
  output: z.object({
    chat: chatRefSchema,
    messages: z.array(messageSchema),
    older: z.string().nullable().describe("pass as `before` for older messages"),
    newer: z.string().nullable().describe("pass as `after` for newer messages"),
  }),
  run(args, env) {
    const ctx = env.read();
    const chat = chatRefOf(ctx, args.chat);
    const page = listMessages(ctx, chat.jid, {
      before: args.before,
      after: args.after,
      around: args.around_message_id,
      limit: args.limit,
    });
    const lines = [`chat ${chatRef(chat.jid, chat.name)}, oldest first:`];
    lines.push(
      ...(page.messages.length ? page.messages.map((m) => messageLine(m)) : ["no messages"]),
    );
    if (page.older) lines.push(`older messages: before ${quote(page.older)}`);
    if (page.newer) lines.push(`newer messages: after ${quote(page.newer)}`);
    return {
      lines,
      structured: { chat, ...page },
      chat: chat.jid,
      count: page.messages.length,
    };
  },
});
