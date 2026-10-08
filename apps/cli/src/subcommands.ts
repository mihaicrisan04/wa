import { UsageError, type CommandIO } from "./command";

export type Subcommand = (args: string[], io: CommandIO) => Promise<number>;

/** `wa <group> <subcommand> ...`: dispatches, or prints the group's usage. */
export async function dispatch(
  group: string,
  usage: string,
  subcommands: Record<string, Subcommand>,
  args: string[],
  io: CommandIO,
): Promise<number> {
  const [name, ...rest] = args;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    io.out(usage);
    return name ? 0 : 2;
  }
  if (!Object.hasOwn(subcommands, name)) {
    throw new UsageError(`unknown subcommand "${name}"\n\n${usage}`);
  }
  return subcommands[name]!(rest, io);
}

/** Exactly `count` positionals, named for the error message. */
export function expect(positionals: string[], names: string[], usage: string): string[] {
  if (positionals.length !== names.length) {
    throw new UsageError(`expected ${names.map((name) => `<${name}>`).join(" ")}\n\n${usage}`);
  }
  return positionals;
}

export function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
