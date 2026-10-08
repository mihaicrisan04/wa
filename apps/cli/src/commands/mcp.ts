import { oneOf } from "../args";
import { UsageError } from "../command";
import { defineGroup, defineSubcommand } from "../define";
import { installMcp, MCP_CLIENTS } from "../mcp/install";
import { readTokenFile } from "../mcp/token-file";

export const mcp = defineGroup({
  name: "mcp",
  summary: "connect AI agents (Claude Code, Codex) to the engine over MCP",
  subcommands: {
    install: defineSubcommand({
      usage: `wa mcp install --profile <p> [--project <dir>] [--client ${MCP_CLIENTS.join("|")}]`,
      options: {
        profile: { type: "string" },
        project: { type: "string" },
        client: { type: "string" },
      },
      async run({ values, help }, io) {
        if (!values.profile) throw new UsageError(`--profile is required\n\n${help}`);
        const client = oneOf(values.client, MCP_CLIENTS, "--client") ?? "claude";
        return installMcp({ profile: values.profile, project: values.project, client }, io);
      },
    }),
    /** Claude Code's headersHelper: prints the auth header, never touches the engine. */
    headers: defineSubcommand({
      usage: "wa mcp headers --token-file <file>",
      options: { "token-file": { type: "string" } },
      async run({ values, help }, io) {
        const file = values["token-file"];
        if (!file) throw new UsageError(`--token-file is required\n\n${help}`);
        io.out(JSON.stringify({ Authorization: `Bearer ${await readTokenFile(file)}` }));
        return 0;
      },
    }),
  },
});
