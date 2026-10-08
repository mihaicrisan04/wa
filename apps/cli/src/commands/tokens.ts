import { parseArgs } from "node:util";
import type { Command } from "../command";
import { engineClient } from "../engine-client";
import { json, table, time } from "../output";
import { dispatch, expect } from "../subcommands";

const USAGE = `usage:
  wa tokens ls [--profile p] [--json]
  wa tokens create <profile> [--label l]
  wa tokens revoke <id>`;

export const tokens: Command = {
  name: "tokens",
  summary: "bearer tokens for HTTP and MCP clients",
  run: (args, io) =>
    dispatch(
      "tokens",
      USAGE,
      {
        async ls(rest) {
          const { values } = parseArgs({
            args: rest,
            options: { profile: { type: "string" }, json: { type: "boolean" } },
            strict: true,
          });
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
        async create(rest) {
          const { values, positionals } = parseArgs({
            args: rest,
            options: { label: { type: "string" } },
            allowPositionals: true,
            strict: true,
          });
          const [profile] = expect(positionals, ["profile"], USAGE);
          const created = await engineClient(io.env).admin.tokens.create({
            profile: profile!,
            label: values.label,
          });
          io.err(`token ${created.id} for profile ${created.profile} (shown once, store it now):`);
          io.out(created.token);
          return 0;
        },
        async revoke(rest) {
          const [id] = expect(
            parseArgs({ args: rest, allowPositionals: true }).positionals,
            ["id"],
            USAGE,
          );
          await engineClient(io.env).admin.tokens.revoke(id!);
          io.out(`revoked ${id}`);
          return 0;
        },
      },
      args,
      io,
    ),
};
