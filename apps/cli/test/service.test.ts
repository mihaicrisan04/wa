import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnExec, type Exec, type ExecResult } from "../src/exec";
import { SERVICE_LABEL, parseLaunchctlPrint, servicePlist } from "../src/service/launchd";
import { OK, recorder, run as runWa } from "./support";

const FAILED: ExecResult = {
  code: 5,
  stdout: "",
  stderr: "Bootstrap failed: 5: Input/output error",
};
const UID = process.getuid!();

let root: string;
let userHome: string;
let waHome: string;
let binary: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wa service "));
  userHome = join(root, "home & co");
  waHome = join(root, "wa home");
  binary = join(root, "build", "wa");
  await mkdir(join(root, "build"));
  await writeFile(binary, "#!/bin/sh\necho wa\n");
});

afterEach(() => rm(root, { recursive: true, force: true }));

interface RunOptions {
  env?: Record<string, string | undefined>;
  exec?: Exec;
  waCommand?: string[];
  cwd?: string;
}

function run(
  argv: string[],
  { env = { WA_HOME: waHome }, exec = recorder().exec, waCommand = [binary], cwd }: RunOptions = {},
) {
  return runWa(["service", ...argv], {
    env,
    exec,
    waCommand,
    homeDir: userHome,
    pollMs: 1,
    cwd,
  });
}

const plistPath = () => join(userHome, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
const installedBinary = () => join(userHome, ".local", "bin", "wa");
const logFile = () => join(userHome, "Library", "Logs", "wa", "engine.log");

/** The installed plist as plutil reads it, so its layout doesn't matter. */
function installedPlist(): Record<string, unknown> {
  const json = Bun.spawnSync(["plutil", "-convert", "json", "-o", "-", plistPath()]);
  expect(json.exitCode).toBe(0);
  return JSON.parse(json.stdout.toString()) as Record<string, unknown>;
}

describe("wa service install", () => {
  test("copies the binary, writes the plist, excludes auth from backups, reloads launchd", async () => {
    const { argvs, exec } = recorder();
    const result = await run(["install"], { exec });
    expect(result.code).toBe(0);
    expect(result.out).toContain(`installed wa`);

    expect(await readFile(installedBinary(), "utf8")).toBe("#!/bin/sh\necho wa\n");
    expect((await stat(installedBinary())).mode & 0o777).toBe(0o755);
    expect((await stat(join(waHome, "auth"))).mode & 0o777).toBe(0o700);
    expect((await stat(plistPath())).mode & 0o777).toBe(0o644);

    expect(argvs()).toEqual([
      ["tmutil", "addexclusion", join(waHome, "auth")],
      ["launchctl", "bootout", `gui/${UID}/${SERVICE_LABEL}`],
      ["launchctl", "bootstrap", `gui/${UID}`, plistPath()],
    ]);
  });

  test("the plist runs `wa serve` at login with KeepAlive, umask 077 and the log file", async () => {
    await run(["install"], { env: { WA_HOME: waHome, WA_PORT: "7400" } });
    expect(installedPlist()).toEqual({
      Label: SERVICE_LABEL,
      ProgramArguments: [installedBinary(), "serve"],
      EnvironmentVariables: { WA_HOME: waHome, WA_PORT: "7400" },
      RunAtLoad: true,
      KeepAlive: true,
      Umask: 0o077,
      StandardOutPath: logFile(),
      StandardErrorPath: logFile(),
    });
  });

  test("a relative WA_HOME is pinned as an absolute path, since launchd starts in /", async () => {
    const { argvs, exec } = recorder();
    const result = await run(["install"], {
      env: { WA_HOME: "data", WA_PORT: "07400", WA_LOG_LEVEL: "debug" },
      exec,
      cwd: root,
    });
    expect(result.code).toBe(0);
    expect(argvs()[0]).toEqual(["tmutil", "addexclusion", join(root, "data", "auth")]);
    expect(installedPlist().EnvironmentVariables).toEqual({
      WA_HOME: join(root, "data"),
      WA_PORT: "7400",
      WA_LOG_LEVEL: "debug",
    });
    expect(result.out).toContain(join(root, "data"));
  });

  test("the plist is valid for plutil", async () => {
    await run(["install"]);
    const lint = Bun.spawnSync(["plutil", "-lint", plistPath()]);
    expect(lint.exitCode).toBe(0);
  });

  test("without WA_HOME the data dir defaults under the user's home and no env is pinned", async () => {
    const { argvs, exec } = recorder();
    await run(["install"], { env: {}, exec });
    const defaultAuth = join(userHome, "Library", "Application Support", "wa", "auth");
    expect(argvs()[0]).toEqual(["tmutil", "addexclusion", defaultAuth]);
    expect(installedPlist()).not.toHaveProperty("EnvironmentVariables");
  });

  test("refuses to install when running from source", async () => {
    const { argvs, exec } = recorder();
    const result = await run(["install"], { exec, waCommand: ["/usr/bin/bun", "index.ts"] });
    expect(result.code).toBe(1);
    expect(result.err).toContain("compiled binary");
    expect(argvs()).toEqual([]);
    expect(await stat(plistPath()).catch(() => null)).toBeNull();
  });

  test("reinstalling over the installed binary leaves it in place", async () => {
    await run(["install"]);
    const result = await run(["install"], { waCommand: [installedBinary()] });
    expect(result.code).toBe(0);
    expect(await readFile(installedBinary(), "utf8")).toBe("#!/bin/sh\necho wa\n");
  });

  test("retries a bootstrap that races the bootout, then gives up", async () => {
    const retried = recorder({ "launchctl bootstrap": [FAILED] });
    expect((await run(["install"], { exec: retried.exec })).code).toBe(0);
    expect(retried.argvs().filter((argv) => argv[1] === "bootstrap")).toHaveLength(2);

    const failing = recorder({ "launchctl bootstrap": Array(5).fill(FAILED) });
    const result = await run(["install"], { exec: failing.exec });
    expect(result.code).toBe(1);
    expect(result.err).toContain("launchctl bootstrap failed: Bootstrap failed: 5");
  });

  test("a failed Time Machine exclusion is a warning", async () => {
    const { exec } = recorder({ "tmutil addexclusion": [{ ...FAILED, stderr: "denied" }] });
    const result = await run(["install"], { exec });
    expect(result.code).toBe(0);
    expect(result.err).toContain("could not exclude");
  });

  test("takes no arguments", async () => {
    const result = await run(["install", "now"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('unexpected "now"');
  });
});

describe("wa service uninstall", () => {
  test("boots the agent out and removes the plist, keeping the binary and data", async () => {
    await run(["install"]);
    const { argvs, exec } = recorder();
    const result = await run(["uninstall"], { exec });
    expect(result.code).toBe(0);
    expect(argvs()).toEqual([["launchctl", "bootout", `gui/${UID}/${SERVICE_LABEL}`]]);
    expect(await stat(plistPath()).catch(() => null)).toBeNull();
    expect(await stat(installedBinary())).toBeTruthy();
    expect(result.out).toContain(`kept ${installedBinary()}`);
  });
});

const PRINTED = `gui/${UID}/${SERVICE_LABEL} = {
\tactive count = 1
\tpath = /Users/x/Library/LaunchAgents/${SERVICE_LABEL}.plist
\tstate = running
\tenvironment = {
\t\tstate = nested
\t}
\tpid = 4242
\tlast exit code = (never exited)
}`;

describe("wa service status", () => {
  test("not installed exits 1 without asking launchd", async () => {
    const { argvs, exec } = recorder();
    const result = await run(["status"], { exec });
    expect(result).toMatchObject({ code: 1, out: "not installed (wa service install)" });
    expect(argvs()).toEqual([]);
  });

  test("shows state and pid from launchctl print", async () => {
    await run(["install"]);
    const { argvs, exec } = recorder({ "launchctl print": [{ ...OK, stdout: PRINTED }] });
    const result = await run(["status"], { exec });
    expect(result.code).toBe(0);
    expect(argvs()).toEqual([["launchctl", "print", `gui/${UID}/${SERVICE_LABEL}`]]);
    expect(result.out).toMatch(/state +running/);
    expect(result.out).toMatch(/pid +4242/);
    expect(result.out).toMatch(/last exit +\(never exited\)/);
  });

  test("an installed agent launchd doesn't know is not loaded", async () => {
    await run(["install"]);
    const { exec } = recorder({ "launchctl print": [{ ...FAILED, code: 113 }] });
    const result = await run(["status"], { exec });
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/state +not loaded/);
  });

  test("parseLaunchctlPrint reads only the service's own fields", () => {
    expect(parseLaunchctlPrint(PRINTED)).toEqual({
      state: "running",
      pid: 4242,
      lastExit: "(never exited)",
    });
    expect(parseLaunchctlPrint("")).toEqual({ state: "unknown", pid: null, lastExit: null });
  });
});

describe("wa service logs", () => {
  test("prints the last n lines", async () => {
    await mkdir(join(userHome, "Library", "Logs", "wa"), { recursive: true });
    await writeFile(logFile(), "one\ntwo\nthree\n");
    expect(await run(["logs", "-n", "2"], { exec: spawnExec })).toMatchObject({
      code: 0,
      out: "two\nthree",
    });
  });

  test("says so when there is no log yet", async () => {
    const result = await run(["logs"]);
    expect(result.code).toBe(1);
    expect(result.err).toStartWith("wa service: no logs yet at ");
  });

  test("rejects a bad line count", async () => {
    expect((await run(["logs", "-n", "0"])).code).toBe(2);
  });
});

test("servicePlist escapes XML in paths", () => {
  const plist = servicePlist({ binary: "/a<b>/wa", logFile: "/l&g", env: {} });
  expect(plist).toContain("<string>/a&lt;b&gt;/wa</string>");
  expect(plist).toContain("<string>/l&amp;g</string>");
});
