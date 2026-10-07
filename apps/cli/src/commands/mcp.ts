import { parseArgs } from "node:util";
import { UsageError, type Command } from "../command";
import { installMcp, type McpClient } from "../mcp/install";
import { readTokenFile } from "../mcp/token-file";
import { dispatch } from "../subcommands";

const USAGE = `usage:
  wa mcp install --profile <p> [--project <dir>] [--client claude|codex]
  wa mcp headers --token-file <file>`;

const CLIENTS: McpClient[] = ["claude", "codex"];

export const mcp: Command = {
  name: "mcp",
  summary: "connect AI agents (Claude Code, Codex) to the engine over MCP",
  run: (args, io) =>
    dispatch(
      "mcp",
      USAGE,
      {
        async install(rest) {
          const { values, positionals } = parseArgs({
            args: rest,
            options: {
              profile: { type: "string" },
              project: { type: "string" },
              client: { type: "string", default: "claude" },
            },
            allowPositionals: true,
            strict: true,
          });
          if (positionals.length)
            throw new UsageError(`unexpected "${positionals[0]}"\n\n${USAGE}`);
          if (!values.profile) throw new UsageError(`--profile is required\n\n${USAGE}`);
          const client = values.client as McpClient;
          if (!CLIENTS.includes(client)) {
            throw new UsageError(`--client must be one of ${CLIENTS.join(", ")}`);
          }
          return installMcp({ profile: values.profile, project: values.project, client }, io);
        },
        /** Claude Code's headersHelper: prints the auth header, never touches the engine. */
        async headers(rest) {
          const { values } = parseArgs({
            args: rest,
            options: { "token-file": { type: "string" } },
            strict: true,
          });
          const file = values["token-file"];
          if (!file) throw new UsageError(`--token-file is required\n\n${USAGE}`);
          io.out(JSON.stringify({ Authorization: `Bearer ${await readTokenFile(file)}` }));
          return 0;
        },
      },
      args,
      io,
    ),
};
