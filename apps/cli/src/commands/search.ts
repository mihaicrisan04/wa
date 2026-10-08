import { parseArgs } from "node:util";
import { UsageError, type Command } from "../command";
import { engineClient } from "../engine-client";
import { highlight, json, time, who } from "../output";
import { positiveInt } from "./chats";

export const search: Command = {
  name: "search",
  summary: "full-text search over stored messages",
  async run(args, io) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        chat: { type: "string" },
        sender: { type: "string" },
        limit: { type: "string", default: "20" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) {
      io.out("usage: wa search <query> [--chat c] [--sender s] [--limit n] [--json]");
      return 0;
    }
    const q = positionals.join(" ");
    if (!q) throw new UsageError("what to search for?");
    const page = await engineClient(io.env).search({
      q,
      chat: values.chat,
      sender: values.sender,
      limit: positiveInt(values.limit, "--limit"),
    });
    if (values.json) {
      io.out(json(page.items));
      return 0;
    }
    if (!page.items.length) {
      io.out("no matches");
      return 0;
    }
    for (const { message, chatName, snippet } of page.items) {
      const sender = message.fromMe ? "me" : who(message.sender, message.senderName);
      const chat = who(message.chat, chatName);
      io.out(`${chat}  [${time(message.ts)}] ${sender}: ${highlight(snippet, io.isTTY)}`);
    }
    return 0;
  },
};
