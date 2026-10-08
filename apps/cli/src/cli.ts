import { ENGINE_VERSION } from "@wa/engine";
import { EXIT_USAGE, type Command, type CommandIO } from "./command";
import { selftest } from "./commands/selftest";
import { serve } from "./commands/serve";

export const COMMANDS: Command[] = [serve, selftest];

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
    if (isUsageError(err)) {
      io.err(`wa ${name}: ${err.message}`);
      return EXIT_USAGE;
    }
    throw err;
  }
}

/** `util.parseArgs` rejects unknown or malformed options with these codes. */
function isUsageError(err: unknown): err is Error {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_");
}
