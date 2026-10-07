import { realpath } from "node:fs/promises";
import { loadConfig } from "@wa/engine";
import { UsageError, type CommandIO } from "../command";
import { engineClient } from "../engine-client";
import { spawnExec, shellWord, waCommand } from "../exec";
import { registerWithClaude } from "./claude";
import { addDenyRules, denyReadRule } from "./settings";
import { mcpTokenPath, projectKey, writeTokenFile } from "./token-file";

export type McpClient = "claude" | "codex";

export interface InstallOptions {
  profile: string;
  /** The project directory; the current directory when absent. */
  project?: string;
  client: McpClient;
}

const MAX_LABEL = 200;

/** Issues a fresh token for the profile, retires the one issued before, and wires the client. */
export async function installMcp(options: InstallOptions, io: CommandIO): Promise<number> {
  const config = loadConfig(io.env);
  const url = `http://127.0.0.1:${config.port}/mcp`;
  const dir = await realpath(options.project ?? io.cwd ?? process.cwd()).catch(() => {
    throw new UsageError(`--project: no such directory: ${options.project}`);
  });
  const key = options.client === "claude" ? projectKey(dir) : "codex";
  const labelKey = `mcp:${options.client}:${options.client === "claude" ? key : options.profile}`;
  const tokenFile = mcpTokenPath(config.home, options.profile, key);

  const admin = engineClient(io.env).admin;
  const created = await admin.tokens.create({
    profile: options.profile,
    label: `${labelKey} ${dir}`.slice(0, MAX_LABEL),
  });
  await writeTokenFile(tokenFile, created.token);
  const previous = (await admin.tokens.list()).filter(
    (token) =>
      token.id !== created.id &&
      token.revokedAt === null &&
      (token.label === labelKey || token.label?.startsWith(`${labelKey} `)),
  );
  for (const token of previous) await admin.tokens.revoke(token.id);
  io.err(
    `token ${created.id} for profile ${options.profile} in ${tokenFile}` +
      (previous.length ? ` (revoked ${previous.map((token) => token.id).join(", ")})` : ""),
  );

  if (options.client === "codex") {
    printCodexSetup(io, url, tokenFile);
    return 0;
  }

  const wa = (io.waCommand ?? waCommand()).map(shellWord).join(" ");
  const helper = `${wa} mcp headers --token-file ${shellWord(tokenFile)}`;
  const how = await registerWithClaude(io.exec ?? spawnExec, dir, {
    url,
    helper,
    token: created.token,
  });
  io.out(`registered MCP server "wa" (${url}) for ${dir} in Claude Code, local scope`);
  if (how === "static header") {
    io.err(
      "this Claude Code has no headersHelper: the token is stored in its config instead (update Claude Code and run this again to move it out)",
    );
  }
  // both spellings of WA_HOME, in case it sits behind a symlink like /tmp
  const homes = new Set([config.home, await realpath(config.home).catch(() => config.home)]);
  const settings = await addDenyRules(dir, [...homes].map(denyReadRule));
  if (settings) io.out(`denied agents reading ${config.home} in ${settings}`);
  return 0;
}

/** Codex has only the global `~/.codex/config.toml`; the token comes from an env variable. */
function printCodexSetup(io: CommandIO, url: string, tokenFile: string) {
  io.out("add this to ~/.codex/config.toml:");
  io.out("");
  io.out("[mcp_servers.wa]");
  io.out(`url = "${url}"`);
  io.out('bearer_token_env_var = "WA_MCP_TOKEN"');
  io.out("");
  io.out("and export the token where Codex starts, e.g. in your shell profile:");
  io.out("");
  io.out(`export WA_MCP_TOKEN="$(cat ${shellWord(tokenFile)})"`);
}
