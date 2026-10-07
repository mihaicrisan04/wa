import { parseArgs } from "node:util";
import type { Command } from "../command";
import { engineClient } from "../engine-client";
import { json, table, time } from "../output";
import { positiveInt } from "./chats";

export const audit: Command = {
  name: "audit",
  summary: "recent sends, MCP tool calls and admin changes",
  async run(args, io) {
    const { values } = parseArgs({
      args,
      options: {
        profile: { type: "string" },
        limit: { type: "string", default: "50" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    });
    if (values.help) {
      io.out("usage: wa audit [--profile p] [--limit n] [--json]");
      return 0;
    }
    const page = await engineClient(io.env).admin.audit({
      profile: values.profile,
      limit: positiveInt(values.limit, "--limit"),
    });
    if (values.json) {
      io.out(json(page.items));
      return 0;
    }
    if (!page.items.length) {
      io.out("nothing audited yet");
      return 0;
    }
    const rows = page.items.map((entry) => [
      time(entry.ts),
      entry.profile ?? "admin",
      entry.action,
      entry.chat ?? "",
      entry.detail ? JSON.stringify(entry.detail) : "",
    ]);
    for (const line of table(rows)) io.out(line);
    return 0;
  },
};
