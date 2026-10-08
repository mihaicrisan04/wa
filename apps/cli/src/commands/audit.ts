import { positiveInt } from "../args";
import { defineCommand } from "../define";
import { engineClient } from "../engine-client";
import { json, table, time } from "../output";

export const audit = defineCommand({
  name: "audit",
  summary: "recent sends, MCP tool calls and admin changes",
  usage: "wa audit [--profile p] [--limit n] [--json]",
  options: {
    profile: { type: "string" },
    limit: { type: "string", default: "50" },
    json: { type: "boolean" },
  },
  async run({ values }, io) {
    const page = await engineClient(io.env).admin.audit({
      profile: values.profile,
      limit: positiveInt(values.limit, "--limit"),
    });
    if (values.json) {
      io.out(json(page));
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
});
