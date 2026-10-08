import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMANDS, runCli } from "../src/cli";
import type { CommandIO } from "../src/command";

const invocations = COMMANDS.flatMap((command) => [
  { argv: [command.name], usage: command.usage },
  ...Object.entries(command.subcommands ?? {}).map(([name, subcommand]) => ({
    argv: [command.name, name],
    usage: subcommand.usage,
  })),
]);

/** If help ever stopped short-circuiting, `service install` or `serve` must still not touch the real machine. */
async function sandboxedRun(argv: string[]) {
  const sandbox = join(tmpdir(), "wa-help-test-never-created");
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIO = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env: { WA_HOME: join(sandbox, "wa"), WA_PORT: "0" },
    homeDir: join(sandbox, "home"),
    waCommand: [join(sandbox, "wa")],
    exec: async (command) => {
      throw new Error(`help ran ${command.join(" ")}`);
    },
  };
  const code = await runCli(argv, io);
  return { code, out: out.join("\n"), err };
}

describe("every command and subcommand answers --help and -h", () => {
  test.each(
    invocations.flatMap(({ argv, usage }) => [
      [[...argv, "--help"], usage],
      [[...argv, "-h"], usage],
    ]),
  )("wa %p", async (argv, usage) => {
    const { code, out, err } = await sandboxedRun(argv);
    expect({ code, err }).toEqual({ code: 0, err: [] });
    expect(out).toStartWith("usage:");
    expect(out).toContain(usage);
  });

  test("--help wins over other mistakes", async () => {
    const { code, out } = await sandboxedRun(["collections", "create", "--bogus", "--help"]);
    expect(code).toBe(0);
    expect(out).toBe("usage: wa collections create <name> [--description d]");
  });
});
