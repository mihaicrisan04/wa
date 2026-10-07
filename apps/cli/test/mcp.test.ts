import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, startEngine, type Engine } from "@wa/engine";
import { FakeWhatsAppClient, makeTempHome, type TempHome } from "@wa/engine/testing";
import { runCli } from "../src/cli";
import type { Exec, ExecResult } from "../src/exec";
import { addHeaderCommand, addJsonCommand, removeCommand } from "../src/mcp/claude";
import { projectKey } from "../src/mcp/token-file";

const WA = ["/opt/wa tools/bin/wa"];
const NOT_FOUND: ExecResult = {
  code: 1,
  stdout: "",
  stderr: 'No MCP server named "wa" in local scope',
};
const OK: ExecResult = { code: 0, stdout: "", stderr: "" };

interface Call {
  argv: string[];
  cwd: string;
}

/** Records every `claude` call and answers from `replies` (then OK). */
function recorder(replies: ExecResult[] = []) {
  const calls: Call[] = [];
  const exec: Exec = async (argv, { cwd }) => {
    calls.push({ argv, cwd });
    return replies.shift() ?? OK;
  };
  return { calls, exec };
}

async function run(
  argv: string[],
  env: Record<string, string | undefined>,
  extra: { exec?: Exec; cwd?: string } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env,
    waCommand: WA,
    ...extra,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("arguments", () => {
  const env = { WA_HOME: "/nonexistent/wa" };
  test.each([
    [["mcp"], "usage:"],
    [["mcp", "install"], "--profile is required"],
    [["mcp", "install", "--profile", "p", "--client", "cursor"], "--client must be one of"],
    [["mcp", "install", "--profile", "p", "extra"], 'unexpected "extra"'],
    [["mcp", "headers"], "--token-file is required"],
    [["mcp", "headers", "--token"], "wa mcp:"],
  ])("wa %p", async (argv, message) => {
    const result = await run(argv, env);
    expect(result.code).toBe(2);
    expect(`${result.out}\n${result.err}`).toContain(message);
  });
});

describe("claude commands", () => {
  test("remove, then add-json with a headersHelper whose paths are quoted", () => {
    expect(removeCommand()).toEqual(["claude", "mcp", "remove", "wa", "--scope", "local"]);
    const helper = '"/opt/wa tools/bin/wa" mcp headers --token-file "/a b/t.token"';
    const add = addJsonCommand("http://127.0.0.1:7373/mcp", helper);
    expect(add.slice(0, 6)).toEqual(["claude", "mcp", "add-json", "--scope", "local", "wa"]);
    expect(JSON.parse(add[6]!)).toEqual({
      type: "http",
      url: "http://127.0.0.1:7373/mcp",
      headersHelper: helper,
    });
  });

  test("the fallback puts the positionals before the variadic --header", () => {
    expect(addHeaderCommand("http://127.0.0.1:7373/mcp", "wa_x")).toEqual([
      "claude",
      "mcp",
      "add",
      "--transport",
      "http",
      "--scope",
      "local",
      "wa",
      "http://127.0.0.1:7373/mcp",
      "--header",
      "Authorization: Bearer wa_x",
    ]);
  });
});

describe("against a running engine", () => {
  let temp: TempHome;
  let engine: Engine;
  let env: Record<string, string>;
  let project: string;

  const homeRules = async () =>
    [...new Set([temp.home, await realpath(temp.home)])].map((home) => `Read(/${home}/**)`);
  const tokenPath = (suffix: string) => join(temp.home, "tokens", `mcp-master-${suffix}.token`);
  const listTools = async (token: string) =>
    fetch(`http://127.0.0.1:${engine.port}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

  beforeAll(async () => {
    temp = await makeTempHome();
    engine = await startEngine(temp.config, {
      client: () => new FakeWhatsAppClient(),
      logger: createLogger("silent"),
    });
    env = { WA_HOME: temp.home, WA_PORT: "7399" };
    engine.store.profiles.create({
      name: "master",
      capabilities: ["chats:read", "messages:read"],
      allChats: false,
      collections: [],
    });
  });

  beforeEach(async () => {
    project = await realpath(await mkdtemp(join(tmpdir(), "wa project ")));
  });

  afterAll(async () => {
    await engine.stop();
    await temp.cleanup();
  });

  test("install for Claude: token file, remove-then-add with headersHelper, deny rule", async () => {
    await mkdir(join(project, ".claude"));
    await writeFile(
      join(project, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Bash(ls)"], deny: ["Read(./.env)"] }, model: "x" }),
    );
    const { calls, exec } = recorder([NOT_FOUND]);
    const result = await run(["mcp", "install", "--profile", "master", "--project", project], env, {
      exec,
    });
    expect(result.code).toBe(0);

    const file = tokenPath(projectKey(project));
    const helper = `"/opt/wa tools/bin/wa" mcp headers --token-file "${file}"`;
    expect(calls).toEqual([
      { argv: removeCommand(), cwd: project },
      { argv: addJsonCommand("http://127.0.0.1:7399/mcp", helper), cwd: project },
    ]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    const headers = await run(["mcp", "headers", "--token-file", file], env);
    const { Authorization } = JSON.parse(headers.out) as { Authorization: string };
    expect(Authorization).toMatch(/^Bearer wa_[\w-]{43}$/);
    expect((await listTools(Authorization.slice("Bearer ".length))).status).toBe(200);

    const settings = JSON.parse(
      await readFile(join(project, ".claude", "settings.local.json"), "utf8"),
    );
    expect(settings).toEqual({
      permissions: { allow: ["Bash(ls)"], deny: ["Read(./.env)", ...(await homeRules())] },
      model: "x",
    });
    await rm(project, { recursive: true, force: true });
  });

  test("installing again revokes the previous token of that project", async () => {
    const first = recorder();
    await run(["mcp", "install", "--profile", "master"], env, { exec: first.exec, cwd: project });
    const file = tokenPath(projectKey(project));
    const old = (await readFile(file, "utf8")).trim();
    expect((await listTools(old)).status).toBe(200);

    const second = recorder();
    const again = await run(["mcp", "install", "--profile", "master", "--project", project], env, {
      exec: second.exec,
    });
    expect(again.err).toContain("revoked");
    const fresh = (await readFile(file, "utf8")).trim();
    expect(fresh).not.toBe(old);
    expect((await listTools(old)).status).toBe(401);
    expect((await listTools(fresh)).status).toBe(200);

    const settings = await readFile(join(project, ".claude", "settings.local.json"), "utf8");
    expect(JSON.parse(settings).permissions.deny).toEqual(await homeRules());
    await rm(project, { recursive: true, force: true });
  });

  test("falls back to a static header when add-json is refused", async () => {
    const { calls, exec } = recorder([OK, { code: 1, stdout: "", stderr: "unknown key" }]);
    const result = await run(["mcp", "install", "--profile", "master", "--project", project], env, {
      exec,
    });
    expect(result.code).toBe(0);
    expect(result.err).toContain("no headersHelper");
    const token = (await readFile(tokenPath(projectKey(project)), "utf8")).trim();
    expect(calls.map((call) => call.argv.slice(0, 3))).toEqual([
      ["claude", "mcp", "remove"],
      ["claude", "mcp", "add-json"],
      ["claude", "mcp", "add"],
    ]);
    expect(calls[2]!.argv).toEqual(addHeaderCommand("http://127.0.0.1:7399/mcp", token));
    await rm(project, { recursive: true, force: true });
  });

  test("a failing remove stops the install", async () => {
    const { calls, exec } = recorder([{ code: 2, stdout: "", stderr: "config is locked\nmore" }]);
    const result = await run(["mcp", "install", "--profile", "master", "--project", project], env, {
      exec,
    });
    expect(result).toMatchObject({ code: 1 });
    expect(result.err).toContain("wa mcp: claude mcp remove failed: config is locked");
    expect(calls).toHaveLength(1);
    await rm(project, { recursive: true, force: true });
  });

  test("an unknown profile is a clear error", async () => {
    const result = await run(["mcp", "install", "--profile", "nobody", "--project", project], env, {
      exec: recorder().exec,
    });
    expect(result).toMatchObject({ code: 1, err: "wa mcp: profile not found" });
    await rm(project, { recursive: true, force: true });
  });

  test("Codex gets a config snippet with an env variable, never an inline token", async () => {
    const { calls, exec } = recorder();
    const result = await run(["mcp", "install", "--profile", "master", "--client", "codex"], env, {
      exec,
      cwd: project,
    });
    expect(result.code).toBe(0);
    expect(calls).toEqual([]);
    expect(result.out).toContain("[mcp_servers.wa]");
    expect(result.out).toContain('url = "http://127.0.0.1:7399/mcp"');
    expect(result.out).toContain('bearer_token_env_var = "WA_MCP_TOKEN"');
    expect(result.out).toContain(`export WA_MCP_TOKEN="$(cat "${tokenPath("codex")}")"`);
    expect(result.out).not.toContain("bearer_token =");
    expect(result.out).not.toMatch(/wa_[\w-]{43}/);
    await rm(project, { recursive: true, force: true });
  });

  test("headers refuses a file without a token and never echoes it", async () => {
    const file = join(project, "bad.token");
    await writeFile(file, "not a token\n");
    const result = await run(["mcp", "headers", "--token-file", file], env);
    expect(result).toMatchObject({ code: 1, out: "" });
    expect(result.err).toContain("does not hold a wa token");
    expect(result.err).not.toContain("not a token\n");
    const missing = await run(["mcp", "headers", "--token-file", join(project, "nope")], env);
    expect(missing.err).toContain("can't read the token file");
    await rm(project, { recursive: true, force: true });
  });
});
