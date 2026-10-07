import { parseArgs } from "node:util";
import type { CollectionDetail } from "@wa/sdk";
import { UsageError, type Command, type CommandIO } from "../command";
import { engineClient } from "../engine-client";
import { json, table, who } from "../output";
import { dispatch, expect } from "../subcommands";

const USAGE = `usage:
  wa collections ls [--json]
  wa collections create <name> [--description d]
  wa collections add <name> <chat...>
  wa collections rm <name> <chat...>
  wa collections show <name> [--json]
  wa collections delete <name>

<chat> is a jid, a phone number or a unique part of the chat's name.`;

const JSON_FLAG = { json: { type: "boolean" } } as const;

function parse<T extends Record<string, { type: "string" | "boolean" }>>(
  args: string[],
  options: T,
) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

function printDetail(detail: CollectionDetail, io: CommandIO): void {
  io.out(`${detail.name}${detail.description ? ` — ${detail.description}` : ""}`);
  if (!detail.chats.length) io.out("  (no chats)");
  const rows = detail.chats.map((chat) => [`  ${who(chat.jid, chat.name)}`, chat.kind, chat.jid]);
  for (const line of table(rows)) io.out(line);
}

export const collections: Command = {
  name: "collections",
  summary: "group chats into collections that profiles can be scoped to",
  run: (args, io) =>
    dispatch(
      "collections",
      USAGE,
      {
        async ls(rest) {
          const { values } = parse(rest, JSON_FLAG);
          const list = await engineClient(io.env).admin.collections.list();
          if (values.json) io.out(json(list));
          else if (!list.length) io.out("no collections yet (wa collections create <name>)");
          else {
            const rows = list.map((item) => [
              item.name,
              `${item.chatCount} chats`,
              item.description ?? "",
            ]);
            for (const line of table(rows)) io.out(line);
          }
          return 0;
        },
        async create(rest) {
          const { values, positionals } = parse(rest, { description: { type: "string" } });
          const [name] = expect(positionals, ["name"], USAGE);
          await engineClient(io.env).admin.collections.create({
            name: name!,
            description: values.description,
          });
          io.out(`created collection ${name}`);
          return 0;
        },
        async add(rest) {
          const [name, ...chats] = parse(rest, {}).positionals;
          if (!name || !chats.length) throw new UsageError(`expected <name> <chat...>\n\n${USAGE}`);
          printDetail(await engineClient(io.env).admin.collections.addChats(name, chats), io);
          return 0;
        },
        async rm(rest) {
          const [name, ...chats] = parse(rest, {}).positionals;
          if (!name || !chats.length) throw new UsageError(`expected <name> <chat...>\n\n${USAGE}`);
          const wa = engineClient(io.env);
          let detail: CollectionDetail | null = null;
          for (const chat of chats) detail = await wa.admin.collections.removeChat(name, chat);
          printDetail(detail!, io);
          return 0;
        },
        async show(rest) {
          const { values, positionals } = parse(rest, JSON_FLAG);
          const [name] = expect(positionals, ["name"], USAGE);
          const detail = await engineClient(io.env).admin.collections.get(name!);
          if (values.json) io.out(json(detail));
          else printDetail(detail, io);
          return 0;
        },
        async delete(rest) {
          const [name] = expect(parse(rest, {}).positionals, ["name"], USAGE);
          await engineClient(io.env).admin.collections.delete(name!);
          io.out(`deleted collection ${name} (profiles scoped to it lose access to its chats)`);
          return 0;
        },
      },
      args,
      io,
    ),
};
