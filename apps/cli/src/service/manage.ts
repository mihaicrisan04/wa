import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ENGINE_VERSION, defaultHome, loadConfig, type EngineConfig } from "@wa/engine";
import { FailureError, type CommandIO } from "../command";
import { spawnExec, waCommand, type Exec } from "../exec";
import { table } from "../output";
import {
  SERVICE_ENV_KEYS,
  SERVICE_LABEL,
  bootoutCommand,
  bootstrapCommand,
  excludeFromBackupCommand,
  parseLaunchctlPrint,
  printCommand,
  servicePaths,
  servicePlist,
} from "./launchd";

const BOOTSTRAP_ATTEMPTS = 5;
const RETRY_MS = 500;

interface Context {
  io: CommandIO;
  exec: Exec;
  uid: number;
  paths: ReturnType<typeof servicePaths>;
  config: EngineConfig;
}

function context(io: CommandIO): Context {
  const userHome = io.homeDir ?? homedir();
  return {
    io,
    exec: io.exec ?? spawnExec,
    uid: process.getuid!(),
    paths: servicePaths(userHome),
    config: loadConfig({ ...io.env, WA_HOME: io.env.WA_HOME || defaultHome(userHome) }),
  };
}

/** Copies this binary to ~/.local/bin/wa and (re)loads the launchd agent that runs it. */
export async function installService(io: CommandIO): Promise<number> {
  const ctx = context(io);
  const { paths, config, exec, uid } = ctx;
  const source = io.waCommand ?? waCommand();
  if (source.length !== 1) {
    throw new FailureError(
      "run this from the compiled binary: mise run build && dist/wa service install",
    );
  }
  await installBinary(source[0]!, paths.binary);
  await mkdir(dirname(paths.logFile), { recursive: true, mode: 0o700 });
  await excludeAuthFromBackups(ctx);

  const env = Object.fromEntries(SERVICE_ENV_KEYS.map((key) => [key, io.env[key]]));
  await mkdir(dirname(paths.plist), { recursive: true });
  await writeFile(paths.plist, servicePlist({ binary: paths.binary, logFile: paths.logFile, env }));
  await chmod(paths.plist, 0o644);

  await exec(bootoutCommand(uid), { cwd: "/" });
  await bootstrap(ctx);

  io.out(`installed wa ${ENGINE_VERSION} as the launchd agent ${SERVICE_LABEL}`);
  for (const line of table([
    ["binary", paths.binary],
    ["plist", paths.plist],
    ["logs", paths.logFile],
    ["data", config.home],
    ["api", `http://127.0.0.1:${config.port}`],
  ])) {
    io.out(`  ${line}`);
  }
  io.out("next: `wa link` to link WhatsApp, `wa service status` to check on it");
  return 0;
}

/** Replaced by rename, so a running engine keeps its old binary until it restarts. */
async function installBinary(source: string, destination: string): Promise<void> {
  const [from, to] = await Promise.all([realpath(source), realpath(destination).catch(() => null)]);
  if (from === to) return;
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.${process.pid}.part`;
  await copyFile(from, partial);
  await chmod(partial, 0o755);
  await rename(partial, destination);
}

async function excludeAuthFromBackups({ io, exec, config }: Context): Promise<void> {
  const auth = join(config.home, "auth");
  await mkdir(auth, { recursive: true, mode: 0o700 });
  const result = await exec(excludeFromBackupCommand(auth), { cwd: "/" });
  if (result.code !== 0) {
    io.err(`could not exclude ${auth} from Time Machine: ${firstLine(result)}`);
  }
}

/** launchd may still be tearing down the previous instance right after a bootout. */
async function bootstrap({ io, exec, uid, paths }: Context): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const result = await exec(bootstrapCommand(uid, paths.plist), { cwd: "/" });
    if (result.code === 0) return;
    if (attempt === BOOTSTRAP_ATTEMPTS) {
      throw new FailureError(`launchctl bootstrap failed: ${firstLine(result)}`);
    }
    await Bun.sleep(io.pollMs ?? RETRY_MS);
  }
}

/** Stops the agent and removes its plist; the binary and WA_HOME stay. */
export async function uninstallService(io: CommandIO): Promise<number> {
  const { exec, uid, paths, config } = context(io);
  const stopped = await exec(bootoutCommand(uid), { cwd: "/" });
  await rm(paths.plist, { force: true });
  io.out(
    stopped.code === 0
      ? `stopped and removed the launchd agent ${SERVICE_LABEL}`
      : `removed the launchd agent ${SERVICE_LABEL} (it was not running)`,
  );
  io.out(`kept ${paths.binary} and the data in ${config.home}`);
  return 0;
}

/** Exit 0 only while the agent runs. */
export async function serviceStatus(io: CommandIO): Promise<number> {
  const { exec, uid, paths } = context(io);
  const installed = await readFile(paths.plist, "utf8").then(
    () => true,
    () => false,
  );
  if (!installed) {
    io.out(`not installed (wa service install)`);
    return 1;
  }
  const printed = await exec(printCommand(uid), { cwd: "/" });
  const service =
    printed.code === 0
      ? parseLaunchctlPrint(printed.stdout)
      : { state: "not loaded", pid: null, lastExit: null };
  const rows = [
    ["service", SERVICE_LABEL],
    ["state", service.state],
    ...(service.pid ? [["pid", String(service.pid)]] : []),
    ...(service.lastExit ? [["last exit", service.lastExit]] : []),
    ["plist", paths.plist],
    ["binary", paths.binary],
    ["logs", paths.logFile],
  ];
  for (const line of table(rows)) io.out(line);
  return service.state === "running" ? 0 : 1;
}

/** The last `lines` lines of the engine log, or follows it with `tail -F`. */
export async function serviceLogs(
  io: CommandIO,
  { lines, follow }: { lines: number; follow: boolean },
): Promise<number> {
  const { paths } = context(io);
  if (follow) {
    const tail = Bun.spawn(["tail", "-n", String(lines), "-F", paths.logFile], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    return tail.exited;
  }
  const text = await readFile(paths.logFile, "utf8").catch(() => null);
  if (text === null) {
    io.err(`no logs yet at ${paths.logFile}`);
    return 1;
  }
  for (const line of text.trimEnd().split("\n").slice(-lines)) io.out(line);
  return 0;
}

function firstLine({ stdout, stderr }: { stdout: string; stderr: string }): string {
  return (stderr || stdout).trim().split("\n")[0] || "no output";
}
