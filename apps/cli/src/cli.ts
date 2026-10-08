import { ConfigError, ENGINE_VERSION } from "@wa/engine";
import { WaApiError } from "@wa/sdk";
import {
  EXIT_FAILURE,
  EXIT_USAGE,
  FailureError,
  UsageError,
  type Command,
  type CommandIO,
} from "./command";
import { audit } from "./commands/audit";
import { backfill } from "./commands/backfill";
import { chats } from "./commands/chats";
import { collections } from "./commands/collections";
import { link } from "./commands/link";
import { mcp } from "./commands/mcp";
import { profiles } from "./commands/profiles";
import { read } from "./commands/read";
import { reindex } from "./commands/reindex";
import { search } from "./commands/search";
import { selftest } from "./commands/selftest";
import { serve } from "./commands/serve";
import { status } from "./commands/status";
import { tokens } from "./commands/tokens";
import { EngineUnavailableError } from "./engine-client";
import { who } from "./output";

export const COMMANDS: Command[] = [
  serve,
  link,
  status,
  chats,
  read,
  search,
  backfill,
  collections,
  profiles,
  tokens,
  audit,
  mcp,
  reindex,
  selftest,
];

export function helpText(): string {
  const visible = COMMANDS.filter((command) => !command.hidden);
  const width = Math.max(...visible.map((command) => command.name.length));
  const lines = visible.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`);
  return ["usage: wa <command> [options]", "", "commands:", ...lines].join("\n");
}

export async function runCli(argv: string[], io: CommandIO): Promise<number> {
  const [name, ...args] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    io.out(helpText());
    return name ? 0 : EXIT_USAGE;
  }
  if (name === "--version" || name === "-v") {
    io.out(ENGINE_VERSION);
    return 0;
  }

  const command = COMMANDS.find((candidate) => candidate.name === name);
  if (!command) {
    io.err(`wa: unknown command "${name}"\n\n${helpText()}`);
    return EXIT_USAGE;
  }
  try {
    return await command.run(args, io);
  } catch (err) {
    return report(name, err, io);
  }
}

/** Expected failures become one clear line (and candidates); anything else is a bug. */
function report(name: string, err: unknown, io: CommandIO): number {
  if (isUsageError(err) || err instanceof ConfigError) {
    io.err(`wa ${name}: ${err.message}`);
    return EXIT_USAGE;
  }
  if (err instanceof EngineUnavailableError || err instanceof FailureError) {
    io.err(`wa ${name}: ${err.message}`);
    return EXIT_FAILURE;
  }
  if (err instanceof WaApiError) {
    io.err(`wa ${name}: ${err.message}`);
    if (err.candidates.length) {
      io.err("did you mean one of:");
      for (const candidate of err.candidates) {
        io.err(`  ${who(candidate.jid, candidate.name)}  ${candidate.jid}`);
      }
    }
    return EXIT_FAILURE;
  }
  throw err;
}

/** `util.parseArgs` rejects unknown or malformed options with these codes. */
function isUsageError(err: unknown): err is Error {
  if (err instanceof UsageError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_");
}
