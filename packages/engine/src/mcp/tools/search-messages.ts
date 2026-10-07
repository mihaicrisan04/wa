import { MESSAGE_TYPES } from "@wa/sdk";
import { z } from "zod";
import { limitParam, requiredText, searchMessages } from "../../queries";
import { chatRef, messageLine } from "../format";
import { chatInput, messageSchema, timeInput } from "../schemas";
import { defineTool } from "../tool";

export const searchMessagesTool = defineTool({
  name: "search_messages",
  title: "Search messages",
  description:
    "Full-text search over the messages this token can see, best matches first. Accents don't matter (`stefan` finds `Ștefan`); the last word matches as a prefix.",
  requires: ["messages:read"],
  input: z.object({
    query: requiredText.describe("words to find"),
    chat: chatInput.optional(),
    sender: requiredText.optional().describe("a person's jid, phone number or name"),
    after: timeInput.optional(),
    before: timeInput.optional(),
    type: requiredText.optional().describe(`one of ${MESSAGE_TYPES.join(", ")}, ...`),
    limit: limitParam(20, 100),
  }),
  output: z.object({
    hits: z.array(z.object({ message: messageSchema, chatName: z.string().nullable() })),
    more: z.boolean(),
  }),
  run({ query, limit, ...filters }, env) {
    const page = searchMessages(env.read(), { q: query, limit, ...filters });
    const hits = page.items.map(({ message, chatName }) => ({ message, chatName }));
    const lines = hits.length
      ? hits.map(({ message, chatName }) =>
          messageLine(message, [`chat ${chatRef(message.chat, chatName)}`]),
        )
      : ["no messages found"];
    const more = page.nextCursor !== null;
    if (more) lines.push("more matches exist: narrow the search or raise the limit (max 100)");
    const chats = new Set(hits.map((hit) => hit.message.chat));
    return {
      lines,
      structured: { hits, more },
      chat: chats.size === 1 ? [...chats][0] : null,
      count: hits.length,
    };
  },
});
