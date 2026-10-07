import { parseArgs } from "node:util";
import type { ChatKind } from "@wa/sdk";
import { UsageError, type Command } from "../command";
import { engineClient } from "../engine-client";
import { json, table, time, who } from "../output";

const KINDS: ChatKind[] = ["dm", "group", "self", "broadcast", "newsletter", "other"];

export const chats: Command = {
  name: "chats",
  summary: "list chats, most recent first",
  async run(args, io) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        collection: { type: "string" },
        kind: { type: "string" },
        limit: { type: "string", default: "50" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) {
      io.out(
        `usage: wa chats [query] [--collection c] [--kind ${KINDS.join("|")}] [--limit n] [--json]`,
      );
      return 0;
    }
    const kind = values.kind as ChatKind | undefined;
    if (kind && !KINDS.includes(kind))
      throw new UsageError(`--kind must be one of ${KINDS.join(", ")}`);
    const page = await engineClient(io.env).chats({
      q: positionals.join(" ") || undefined,
      collection: values.collection,
      kind,
      limit: positiveInt(values.limit, "--limit"),
    });
    if (values.json) {
      io.out(json(page.items));
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
};

export function positiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new UsageError(`${flag} must be a positive number`);
  return number;
}
