import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE_VERSION, openStore } from "@wa/engine";
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

describe("wa reindex", () => {
  test("reports when there is no store yet", async () => {
    const home = await mkdtemp(join(tmpdir(), "wa cli "));
    try {
      const result = await run(["reindex"], { WA_HOME: home });
      expect(result).toMatchObject({ code: 0, out: "nothing to reindex: no message store yet" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("re-derives stored messages", async () => {
    const home = await mkdtemp(join(tmpdir(), "wa cli "));
    try {
      const store = openStore(join(home, "wa.db"));
      store.db.run(
        `INSERT INTO messages (chat_jid, id, from_me, ts, type, source, raw) VALUES
         ('40700000002@s.whatsapp.net', '3EB0X', 0, 1, 'junk', 'live',
          '{"key":{"remoteJid":"40700000002@s.whatsapp.net","id":"3EB0X"},"messageTimestamp":"1","message":{"conversation":"hi"}}')`,
      );
      store.close();

      const result = await run(["reindex"], { WA_HOME: home });
      expect(result).toMatchObject({
        code: 0,
        out: "reindexed 1 messages (0 without a raw payload)",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("is listed in --help", async () => {
    expect(helpText()).toContain("reindex");
  });
});
