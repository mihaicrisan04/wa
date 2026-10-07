import { realpath } from "node:fs/promises";
import { loadConfig, writeTokenFile } from "@wa/engine";
import { engineUrl, type CreatedToken, type TokenInfo, type WaAdminClient } from "@wa/sdk";
import { UsageError, type CommandIO } from "../command";
import { engineClient } from "../engine-client";
import { spawnExec, shellWord, waCommand } from "../exec";
import { registerWithClaude } from "./claude";
import { addDenyRules, denyReadRule } from "./settings";
import { mcpTokenPath, projectKey } from "./token-file";

export const MCP_CLIENTS = ["claude", "codex"] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

interface InstallOptions {
  profile: string;
  /** The project directory; the current directory when absent. */
  project?: string;
  client: McpClient;
}

const MAX_LABEL = 200;

/** Issues a fresh token for the profile, retires the one issued before, and wires the client. */
export async function installMcp(options: InstallOptions, io: CommandIO): Promise<number> {
  const config = loadConfig(io.env);
  const url = `${engineUrl(config.port)}/mcp`;
  const dir = await realpath(options.project ?? io.cwd ?? process.cwd()).catch(() => {
    throw new UsageError(`--project: no such directory: ${options.project}`);
  });
  const { key, labelKey } = tokenKeys(options, dir);
  const tokenFile = mcpTokenPath(config.home, options.profile, key);

  const { created, revoked } = await rotateMcpToken(engineClient(io.env).admin, {
    profile: options.profile,
    labelKey,
    dir,
  });
  await writeTokenFile(tokenFile, created.token);
  io.err(
    `token ${created.id} for profile ${options.profile} in ${tokenFile}` +
      (revoked.length ? ` (revoked ${revoked.map((token) => token.id).join(", ")})` : ""),
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

/** Claude Code registers per project; Codex has one global config, so one token per profile. */
function tokenKeys({ client, profile }: InstallOptions, dir: string) {
  if (client === "codex") return { key: "codex", labelKey: `mcp:codex:${profile}` };
  const key = projectKey(dir);
  return { key, labelKey: `mcp:claude:${key}` };
}

/** A new token labelled `<labelKey> <dir>`; earlier active tokens with that label key are revoked. */
async function rotateMcpToken(
  admin: WaAdminClient,
  { profile, labelKey, dir }: { profile: string; labelKey: string; dir: string },
): Promise<{ created: CreatedToken; revoked: TokenInfo[] }> {
  const created = await admin.tokens.create({
    profile,
    label: `${labelKey} ${dir}`.slice(0, MAX_LABEL),
  });
  const revoked = (await admin.tokens.list()).filter(
    (token) =>
      token.id !== created.id &&
      token.revokedAt === null &&
      (token.label === labelKey || token.label?.startsWith(`${labelKey} `)),
  );
  for (const token of revoked) await admin.tokens.revoke(token.id);
  return { created, revoked };
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
