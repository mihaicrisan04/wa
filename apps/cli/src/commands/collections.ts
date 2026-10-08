import type { CollectionDetail } from "@wa/sdk";
import type { CommandIO } from "../command";
import { defineGroup, defineSubcommand } from "../define";
import { engineClient } from "../engine-client";
import { json, table, who } from "../output";

const CHAT_NOTE = "<chat> is a jid, a phone number or a unique part of the chat's name.";

function printDetail(detail: CollectionDetail, io: CommandIO): void {
  io.out(`${detail.name}${detail.description ? ` — ${detail.description}` : ""}`);
  if (!detail.chats.length) io.out("  (no chats)");
  const rows = detail.chats.map((chat) => [`  ${who(chat.jid, chat.name)}`, chat.kind, chat.jid]);
  for (const line of table(rows)) io.out(line);
}

export const collections = defineGroup({
  name: "collections",
  summary: "group chats into collections that profiles can be scoped to",
  notes: CHAT_NOTE,
  subcommands: {
    ls: defineSubcommand({
      usage: "wa collections ls [--json]",
      options: { json: { type: "boolean" } },
      async run({ values }, io) {
        const listed = await engineClient(io.env).admin.collections.list();
        if (values.json) io.out(json(listed));
        else if (!listed.items.length) io.out("no collections yet (wa collections create <name>)");
        else {
          const rows = listed.items.map((item) => [
            item.name,
            `${item.chatCount} chats`,
            item.description ?? "",
          ]);
          for (const line of table(rows)) io.out(line);
        }
        return 0;
      },
    }),
    create: defineSubcommand({
      usage: "wa collections create <name> [--description d]",
      options: { description: { type: "string" } },
      positionals: ["name"],
      async run({ values, positionals: [name] }, io) {
        await engineClient(io.env).admin.collections.create({
          name,
          description: values.description,
        });
        io.out(`created collection ${name}`);
        return 0;
      },
    }),
    add: defineSubcommand({
      usage: "wa collections add <name> <chat...>",
      description: CHAT_NOTE,
      positionals: ["name", "chat"],
      variadic: true,
      async run({ positionals: [name, ...chats] }, io) {
        printDetail(await engineClient(io.env).admin.collections.addChats(name, chats), io);
        return 0;
      },
    }),
    rm: defineSubcommand({
      usage: "wa collections rm <name> <chat...>",
      description: CHAT_NOTE,
      positionals: ["name", "chat"],
      variadic: true,
      async run({ positionals: [name, first, ...more] }, io) {
        const { admin } = engineClient(io.env);
        let detail = await admin.collections.removeChat(name, first);
        for (const chat of more) detail = await admin.collections.removeChat(name, chat);
        printDetail(detail, io);
        return 0;
      },
    }),
    show: defineSubcommand({
      usage: "wa collections show <name> [--json]",
      options: { json: { type: "boolean" } },
      positionals: ["name"],
      async run({ values, positionals: [name] }, io) {
        const detail = await engineClient(io.env).admin.collections.get(name);
        if (values.json) io.out(json(detail));
        else printDetail(detail, io);
        return 0;
      },
    }),
    delete: defineSubcommand({
      usage: "wa collections delete <name>",
      positionals: ["name"],
      async run({ positionals: [name] }, io) {
        await engineClient(io.env).admin.collections.delete(name);
        io.out(`deleted collection ${name} (profiles scoped to it lose access to its chats)`);
        return 0;
      },
    }),
  },
});
