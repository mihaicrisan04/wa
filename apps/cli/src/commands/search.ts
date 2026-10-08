import { positiveInt } from "../args";
import { UsageError } from "../command";
import { defineCommand } from "../define";
import { engineClient } from "../engine-client";
import { highlight, json, senderOf, time, who } from "../output";

export const search = defineCommand({
  name: "search",
  summary: "full-text search over stored messages",
  usage: "wa search <query> [--chat c] [--sender s] [--limit n] [--json]",
  options: {
    chat: { type: "string" },
    sender: { type: "string" },
    limit: { type: "string", default: "20" },
    json: { type: "boolean" },
  },
  variadic: true,
  async run({ values, positionals }, io) {
    const q = positionals.join(" ");
    if (!q) throw new UsageError("what to search for?");
    const page = await engineClient(io.env).search({
      q,
      chat: values.chat,
      sender: values.sender,
      limit: positiveInt(values.limit, "--limit"),
    });
    if (values.json) {
      io.out(json(page));
      return 0;
    }
    if (!page.items.length) {
      io.out("no matches");
      return 0;
    }
    for (const { message, chatName, snippet } of page.items) {
      const chat = who(message.chat, chatName);
      const line = `[${time(message.ts)}] ${senderOf(message)}: ${highlight(snippet, io.isTTY)}`;
      io.out(`${chat}  ${line}`);
    }
    return 0;
  },
});
