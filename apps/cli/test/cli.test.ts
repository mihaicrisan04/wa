import { describe, expect, test } from "bun:test";
import { ENGINE_VERSION } from "@wa/engine";
import { helpText, runCli } from "../src/cli";

async function run(argv: string[], env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("wa", () => {
  test("no command prints usage and exits 2", async () => {
    const result = await run([]);
    expect(result.code).toBe(2);
    expect(result.out).toContain("usage: wa <command>");
  });

  test("--help lists serve but hides selftest", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("serve");
    expect(helpText()).not.toContain("selftest");
  });

  test("--version prints the engine version", async () => {
    expect(await run(["--version"])).toMatchObject({ code: 0, out: ENGINE_VERSION });
  });

  test("unknown commands exit 2", async () => {
    const result = await run(["bogus"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown command "bogus"');
  });

  test("selftest runs even though it is hidden", async () => {
    const result = await run(["selftest"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("ok");
  });
});

describe("wa serve", () => {
  test("rejects unknown options", async () => {
    const result = await run(["serve", "--bogus"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("wa serve:");
  });

  test("rejects an invalid port before starting anything", async () => {
    const result = await run(["serve", "--port", "99999"], { WA_HOME: "/nonexistent/wa" });
    expect(result.code).toBe(2);
    expect(result.err).toContain("WA_PORT");
  });

  test("--help explains the environment", async () => {
    const result = await run(["serve", "--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("WA_HOME");
  });
});
