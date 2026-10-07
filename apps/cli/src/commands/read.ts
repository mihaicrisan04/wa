import { parseArgs } from "node:util";
import { UsageError, type Command } from "../command";
import { engineClient } from "../engine-client";
import { json, messageLine } from "../output";
import { positiveInt } from "./chats";

export const read: Command = {
  name: "read",
  summary: "show a chat's latest messages",
  async run(args, io) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        limit: { type: "string", default: "50" },
        before: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) {
      io.out(
        "usage: wa read <chat> [--limit n] [--before <date|cursor>] [--json]\n\n<chat> is a jid, a phone number or a unique part of the chat's name.",
      );
      return 0;
    }
    const chat = positionals.join(" ");
    if (!chat) throw new UsageError("which chat? (a jid, a phone number or a name)");
    const page = await engineClient(io.env).messages(chat, {
      limit: positiveInt(values.limit, "--limit"),
      before: values.before,
    });
    if (values.json) {
      io.out(json(page));
      return 0;
    }
    for (const message of page.messages) io.out(messageLine(message));
    if (page.older) io.out(`(older: wa read ${JSON.stringify(chat)} --before ${page.older})`);
    return 0;
  },
};
