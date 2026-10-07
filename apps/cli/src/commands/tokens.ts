import { defineGroup, defineSubcommand } from "../define";
import { engineClient } from "../engine-client";
import { json, table, time } from "../output";

export const tokens = defineGroup({
  name: "tokens",
  summary: "bearer tokens for HTTP and MCP clients",
  subcommands: {
    ls: defineSubcommand({
      usage: "wa tokens ls [--profile p] [--json]",
      options: { profile: { type: "string" }, json: { type: "boolean" } },
      async run({ values }, io) {
        const list = await engineClient(io.env).admin.tokens.list(values.profile);
        if (values.json) {
          io.out(json(list));
          return 0;
        }
        if (!list.length) {
          io.out("no tokens");
          return 0;
        }
        const rows = list.map((token) => [
          token.id,
          token.profile,
          token.revokedAt ? `revoked ${time(token.revokedAt)}` : "active",
          token.lastUsedAt ? `used ${time(token.lastUsedAt)}` : "never used",
          token.label ?? "",
        ]);
        for (const line of table(rows)) io.out(line);
        return 0;
      },
    }),
    create: defineSubcommand({
      usage: "wa tokens create <profile> [--label l]",
      options: { label: { type: "string" } },
      positionals: ["profile"],
      async run({ values, positionals: [profile] }, io) {
        const created = await engineClient(io.env).admin.tokens.create({
          profile,
          label: values.label,
        });
        io.err(`token ${created.id} for profile ${created.profile} (shown once, store it now):`);
        io.out(created.token);
        return 0;
      },
    }),
    revoke: defineSubcommand({
      usage: "wa tokens revoke <id>",
      positionals: ["id"],
      async run({ positionals: [id] }, io) {
        await engineClient(io.env).admin.tokens.revoke(id);
        io.out(`revoked ${id}`);
        return 0;
      },
    }),
  },
});
