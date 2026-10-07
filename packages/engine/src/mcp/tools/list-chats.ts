import { z } from "zod";
import { listChats } from "../../queries";
import { chatLine } from "../format";
import { chatSchema, limitInput } from "../schemas";
import { defineTool } from "../tool";

export const listChatsTool = defineTool({
  name: "list_chats",
  title: "List chats",
  description:
    "Chats this token can see, most recent first. Filter by part of the name or jid, or by collection.",
  requires: ["chats:read"],
  input: z.object({
    query: z.string().trim().min(1).optional().describe("part of the chat's name or jid"),
    collection: z.string().trim().min(1).optional().describe("only chats in this collection"),
    limit: limitInput(50, 200),
  }),
  output: z.object({ chats: z.array(chatSchema), more: z.boolean() }),
  run({ query, collection, limit }, env) {
    const page = listChats(env.read(), { q: query, collection, limit });
    const more = page.nextCursor !== null;
    const lines = page.items.length ? page.items.map(chatLine) : ["no chats found"];
    if (more) lines.push(`more chats exist: narrow the query or raise the limit (max 200)`);
    return { lines, structured: { chats: page.items, more }, count: page.items.length };
  },
});
