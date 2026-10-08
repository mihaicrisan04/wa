import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { databasePath, ENGINE_VERSION, openStore } from "@wa/engine";
import { ANA_PN, makeTempHome, messageRecord, type TempHome } from "@wa/engine/testing";
import { helpText } from "../src/cli";
import { run as runWa } from "./support";

const run = (argv: string[], env: Record<string, string | undefined> = {}) => runWa(argv, { env });

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
  let temp: TempHome;

  beforeEach(async () => {
    temp = await makeTempHome();
  });

  afterEach(() => temp.cleanup());

  test("reports when there is no store yet", async () => {
    const result = await run(["reindex"], { WA_HOME: temp.home });
    expect(result).toMatchObject({ code: 0, out: "nothing to reindex: no message store yet" });
  });

  test("re-derives stored messages", async () => {
    const store = openStore(databasePath(temp.home));
    store.messages.upsert(
      messageRecord({
        type: "junk",
        raw: JSON.stringify({
          key: { remoteJid: ANA_PN, id: "3EB0A" },
          messageTimestamp: "1",
          message: { conversation: "hi" },
        }),
      }),
    );
    store.close();

    const result = await run(["reindex"], { WA_HOME: temp.home });
    expect(result).toMatchObject({
      code: 0,
      out: "reindexed 1 messages (0 without a raw payload)",
    });
  });

  test("is listed in --help", async () => {
    expect(helpText()).toContain("reindex");
  });
});
