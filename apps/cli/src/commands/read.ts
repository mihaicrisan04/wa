import { positiveInt } from "../args";
import { UsageError } from "../command";
import { defineCommand } from "../define";
import { engineClient } from "../engine-client";
import { json, messageLine } from "../output";

export const read = defineCommand({
  name: "read",
  summary: "show a chat's latest messages",
  usage: "wa read <chat> [--limit n] [--before <date|cursor>] [--json]",
  description: "<chat> is a jid, a phone number or a unique part of the chat's name.",
  options: {
    limit: { type: "string", default: "50" },
    before: { type: "string" },
    json: { type: "boolean" },
  },
  variadic: true,
  async run({ values, positionals }, io) {
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
    for (const message of page.items) io.out(messageLine(message));
    if (page.older) io.out(`(older: wa read ${JSON.stringify(chat)} --before ${page.older})`);
    return 0;
  },
});
