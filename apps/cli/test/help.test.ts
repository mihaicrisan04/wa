import { describe, expect, test } from "bun:test";
import { COMMANDS, runCli } from "../src/cli";

const invocations = COMMANDS.flatMap((command) => [
  { argv: [command.name], usage: command.usage },
  ...Object.entries(command.subcommands ?? {}).map(([name, subcommand]) => ({
    argv: [command.name, name],
    usage: subcommand.usage,
  })),
]);

describe("every command and subcommand answers --help and -h", () => {
  test.each(
    invocations.flatMap(({ argv, usage }) => [
      [[...argv, "--help"], usage],
      [[...argv, "-h"], usage],
    ]),
  )("wa %p", async (argv, usage) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      env: { WA_HOME: "/nonexistent/wa" },
    });
    expect({ code, err }).toEqual({ code: 0, err: [] });
    expect(out.join("\n")).toStartWith("usage:");
    expect(out.join("\n")).toContain(usage);
  });

  test("--help wins over other mistakes", async () => {
    const out: string[] = [];
    const code = await runCli(["collections", "create", "--bogus", "--help"], {
      out: (line) => out.push(line),
      err: () => {},
      env: {},
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toBe("usage: wa collections create <name> [--description d]");
  });
});
