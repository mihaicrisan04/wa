import { CHAT_KINDS } from "@wa/sdk";
import { oneOf, positiveInt } from "../args";
import { defineCommand } from "../define";
import { engineClient } from "../engine-client";
import { json, table, time, who } from "../output";

export const chats = defineCommand({
  name: "chats",
  summary: "list chats, most recent first",
  usage: `wa chats [query] [--collection c] [--kind ${CHAT_KINDS.join("|")}] [--limit n] [--json]`,
  options: {
    collection: { type: "string" },
    kind: { type: "string" },
    limit: { type: "string", default: "50" },
    json: { type: "boolean" },
  },
  variadic: true,
  async run({ values, positionals }, io) {
    const page = await engineClient(io.env).chats({
      q: positionals.join(" ") || undefined,
      collection: values.collection,
      kind: oneOf(values.kind, CHAT_KINDS, "--kind"),
      limit: positiveInt(values.limit, "--limit"),
    });
    if (values.json) {
      io.out(json(page));
      return 0;
    }
    if (!page.items.length) {
      io.out("no chats");
      return 0;
    }
    const rows = page.items.map((chat) => [
      who(chat.jid, chat.name),
      chat.kind,
      time(chat.lastMessageAt),
      chat.jid,
    ]);
    for (const line of table(rows)) io.out(line);
    return 0;
  },
});
