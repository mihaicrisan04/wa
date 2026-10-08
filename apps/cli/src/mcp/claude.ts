import { FailureError } from "../command";
import { firstLine, type Exec } from "../exec";

const SERVER_NAME = "wa";

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

/** How a Claude Code without `headersHelper` refuses the key; any other failure is not a fallback. */
const HEADERS_HELPER_REFUSED = /headersHelper|unrecogni[sz]ed key|unknown key/i;

type Registration = "headersHelper" | "static header";

/** Replaces any earlier `wa` server of the project, preferring the headers helper. */
export async function registerWithClaude(
  exec: Exec,
  dir: string,
  { url, helper, token }: { url: string; helper: string; token: string },
): Promise<Registration> {
  const removed = await exec(removeCommand(), { cwd: dir });
  if (removed.code !== 0 && !/no mcp server/i.test(removed.stdout + removed.stderr)) {
    throw new FailureError(`claude mcp remove failed: ${firstLine(removed)}`);
  }
  const addedJson = await exec(addJsonCommand(url, helper), { cwd: dir });
  if (addedJson.code === 0) return "headersHelper";
  if (!HEADERS_HELPER_REFUSED.test(addedJson.stderr || addedJson.stdout)) {
    throw new FailureError(`claude mcp add-json failed: ${firstLine(addedJson)}`);
  }
  const added = await exec(addHeaderCommand(url, token), { cwd: dir });
  if (added.code !== 0) {
    throw new FailureError(`claude mcp add failed: ${firstLine(added)}`);
  }
  return "static header";
}
