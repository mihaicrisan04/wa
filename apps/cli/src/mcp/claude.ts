import { FailureError } from "../command";
import type { Exec } from "../exec";

export const SERVER_NAME = "wa";

/** Local scope: the server is registered for this project only, outside the repo. */
export function removeCommand(): string[] {
  return ["claude", "mcp", "remove", SERVER_NAME, "--scope", "local"];
}

/** Claude Code runs `helper` for the headers, so the token stays in its 0600 file. */
export function addJsonCommand(url: string, helper: string): string[] {
  const config = { type: "http", url, headersHelper: helper };
  return ["claude", "mcp", "add-json", "--scope", "local", SERVER_NAME, JSON.stringify(config)];
}

/** The fallback for a Claude Code without `headersHelper`: the token goes into its config. */
export function addHeaderCommand(url: string, token: string): string[] {
  return [
    "claude",
    "mcp",
    "add",
    "--transport",
    "http",
    "--scope",
    "local",
    SERVER_NAME,
    url,
    "--header",
    `Authorization: Bearer ${token}`,
  ];
}

export type Registration = "headersHelper" | "static header";

/** Replaces any earlier `wa` server of the project, preferring the headers helper. */
export async function registerWithClaude(
  exec: Exec,
  dir: string,
  { url, helper, token }: { url: string; helper: string; token: string },
): Promise<Registration> {
  const removed = await exec(removeCommand(), { cwd: dir });
  if (removed.code !== 0 && !/no mcp server/i.test(removed.stdout + removed.stderr)) {
    throw new FailureError(
      `claude mcp remove failed: ${firstLine(removed.stderr || removed.stdout)}`,
    );
  }
  if ((await exec(addJsonCommand(url, helper), { cwd: dir })).code === 0) return "headersHelper";
  const added = await exec(addHeaderCommand(url, token), { cwd: dir });
  if (added.code !== 0) {
    throw new FailureError(`claude mcp add failed: ${firstLine(added.stderr || added.stdout)}`);
  }
  return "static header";
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] || "no output";
}
