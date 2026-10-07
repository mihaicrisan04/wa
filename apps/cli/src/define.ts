import { parseArgs, type ParseArgsConfig } from "node:util";
import { EXIT_USAGE, UsageError, type Command, type CommandIO, type Subcommand } from "./command";

type Options = NonNullable<ParseArgsConfig["options"]>;

type Values<O extends Options> = ReturnType<
  typeof parseArgs<{ args: string[]; options: O; strict: true; allowPositionals: true }>
>["values"];

type Named<N extends readonly string[]> = { [K in keyof N]: string };

export interface CommandSpec<O extends Options, N extends readonly string[]> {
  /** One line, e.g. `wa read <chat> [--limit n]`. */
  usage: string;
  /** Printed under the usage by `--help`. */
  description?: string;
  options?: O;
  /** Required positionals, named for the usage error; exactly these unless `variadic`. */
  positionals?: N;
  /** More positionals may follow the named ones (and the last name repeats). */
  variadic?: boolean;
  run(
    input: { values: Values<O>; positionals: [...Named<N>, ...string[]]; help: string },
    io: CommandIO,
  ): Promise<number>;
}

const HELP: Options = { help: { type: "boolean", short: "h" } };

export function isHelp(arg: string | undefined): boolean {
  return arg === "help" || arg === "--help" || arg === "-h";
}

/** A subcommand: strict options, `-h/--help`, and its positionals counted before it runs. */
export function defineSubcommand<
  O extends Options = Record<never, never>,
  const N extends readonly string[] = [],
>(spec: CommandSpec<O, N>): Subcommand {
  const help = spec.description
    ? `usage: ${spec.usage}\n\n${spec.description}`
    : `usage: ${spec.usage}`;
  return {
    usage: spec.usage,
    async run(args, io) {
      if (wantsHelp(args, spec.options)) {
        io.out(help);
        return 0;
      }
      const { values, positionals } = parseArgs({
        args,
        options: spec.options,
        strict: true,
        allowPositionals: true,
      });
      const names = spec.positionals ?? [];
      checkArity(positionals, names, spec.variadic ?? false, help);
      // checkArity made sure every named positional is there
      const named = positionals as [...Named<N>, ...string[]];
      return spec.run({ values, positionals: named, help }, io);
    },
  };
}

/** A top-level `wa <name>` command built like a subcommand. */
export function defineCommand<
  O extends Options = Record<never, never>,
  const N extends readonly string[] = [],
>({
  name,
  summary,
  hidden,
  ...spec
}: CommandSpec<O, N> & Pick<Command, "name" | "summary" | "hidden">): Command {
  return { name, summary, hidden, ...defineSubcommand(spec) };
}

/** `wa <name> <subcommand> ...`: dispatches, or prints every subcommand's usage. */
export function defineGroup({
  name,
  summary,
  notes,
  subcommands,
}: Pick<Command, "name" | "summary"> & {
  notes?: string;
  subcommands: Record<string, Subcommand>;
}): Command {
  const lines = Object.values(subcommands).map((subcommand) => `  ${subcommand.usage}`);
  const usage = ["usage:", ...lines].join("\n") + (notes ? `\n\n${notes}` : "");
  return {
    name,
    summary,
    usage,
    subcommands,
    async run([subname, ...rest], io) {
      if (!subname || isHelp(subname)) {
        io.out(usage);
        return subname ? 0 : EXIT_USAGE;
      }
      const subcommand = Object.hasOwn(subcommands, subname) ? subcommands[subname] : undefined;
      if (!subcommand) throw new UsageError(`unknown subcommand "${subname}"\n\n${usage}`);
      return subcommand.run(rest, io);
    },
  };
}

/** Lenient, so `--help` wins over any mistake in the other arguments. */
function wantsHelp(args: string[], options: Options = {}): boolean {
  const all: Options = { ...options, ...HELP };
  return (
    parseArgs({ args, options: all, strict: false, allowPositionals: true }).values.help === true
  );
}

function checkArity(
  positionals: string[],
  names: readonly string[],
  variadic: boolean,
  help: string,
): void {
  const tooFew = positionals.length < names.length;
  const tooMany = !variadic && positionals.length > names.length;
  if (!tooFew && !tooMany) return;
  if (!names.length) throw new UsageError(`unexpected "${positionals[0]}"\n\n${help}`);
  const last = names.length - 1;
  const expected = names.map((name, i) => (variadic && i === last ? `<${name}...>` : `<${name}>`));
  throw new UsageError(`expected ${expected.join(" ")}\n\n${help}`);
}
