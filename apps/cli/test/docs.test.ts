import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { helpText, runCli } from "../src/cli";

const ROOT = join(import.meta.dir, "..", "..", "..");
const DOCS = ["README.md", "docs/architecture.md", "docs/mcp.md", "docs/security.md"];

const read = (path: string) => readFile(join(ROOT, path), "utf8");

const visibleCommands = () =>
  helpText()
    .split("\n")
    .flatMap((line) => /^ {2}([a-z]+) /.exec(line)?.[1] ?? []);

/** Fenced blocks and inline code spans: where commands are spelled out. */
function codeOf(markdown: string): string[] {
  const fences = [...markdown.matchAll(/^```[a-z]*\n([\s\S]*?)^```/gm)].map((match) => match[1]!);
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, "");
  return [...fences, ...[...prose.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!)];
}

/** The `usage:` lines of `wa <command> --help`, as `wa ...`. */
async function usageLines(command: string): Promise<string[]> {
  const out: string[] = [];
  await runCli([command, "--help"], {
    out: (line) => out.push(line),
    err: () => {},
    env: { WA_HOME: "/nonexistent/wa" },
  });
  return out
    .join("\n")
    .split("\n")
    .flatMap((line) => /^(?:usage: | {2})(wa .*)$/.exec(line)?.[1] ?? []);
}

describe("docs match wa --help", () => {
  test("architecture.md quotes the current help", async () => {
    expect(await read("docs/architecture.md")).toContain(`$ wa --help\n${helpText()}\n`);
  });

  test("architecture.md lists every usage line", async () => {
    const doc = await read("docs/architecture.md");
    for (const command of visibleCommands()) {
      const lines = await usageLines(command);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(doc).toContain(`\n${line}\n`);
    }
  });

  test.each(DOCS)("%s only mentions commands that exist", async (path) => {
    const known = new Set(visibleCommands());
    const mentioned = codeOf(await read(path)).flatMap((code) =>
      [...code.matchAll(/(?:^|\$ |dist\/|")wa ([a-z]+)\b/gm)].map((match) => match[1]!),
    );
    expect(mentioned.length).toBeGreaterThan(0);
    expect(mentioned.filter((name) => !known.has(name))).toEqual([]);
  });
});
