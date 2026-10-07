import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLogger, startEngine, type Engine } from "@wa/engine";
import {
  buildMessage,
  content,
  FakeWhatsAppClient,
  makeTempHome,
  type TempHome,
} from "@wa/engine/testing";
import { runCli } from "../src/cli";

const ME = { id: "40700000001:7@s.whatsapp.net", lid: "100000000000001:7@lid" };
const ANA = "40700000002@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";
const OTHER_GROUP = "120363000000000002@g.us";

async function run(argv: string[], env: Record<string, string | undefined>) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env,
    pollMs: 5,
    historyIdleMs: 50,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("argument checks happen before talking to the engine", () => {
  const env = { WA_HOME: "/nonexistent/wa" };

  test.each([
    [["collections"], "usage:"],
    [["collections", "bogus"], 'unknown subcommand "bogus"'],
    [["tokens", "constructor"], 'unknown subcommand "constructor"'],
    [["profiles", "toString"], 'unknown subcommand "toString"'],
    [["collections", "create"], "expected <name>"],
    [["collections", "add", "master"], "expected <name> <chat...>"],
    [["profiles", "create", "p"], "--caps is required"],
    [["profiles", "create", "p", "--caps", "chats:read,admin"], "unknown capability: admin"],
    [
      ["profiles", "create", "p", "--caps", "send", "--collections", "a", "--all-chats"],
      "not both",
    ],
    [["tokens", "create"], "expected <profile>"],
    [["read"], "which chat?"],
    [["search"], "what to search for?"],
    [["backfill"], "which chat?"],
    [["backfill", "Ana", "--max", "0"], "--max must be a positive number"],
    [["chats", "--kind", "nope"], "--kind must be one of"],
    [["chats", "--limit", "0"], "--limit must be a positive number"],
    [["status", "--bogus"], "wa status:"],
  ])("wa %p", async (argv, message) => {
    const result = await run(argv, env);
    expect(result.code).toBe(2);
    expect(`${result.out}\n${result.err}`).toContain(message);
  });

  test("a stopped engine is a clear error", async () => {
    const temp = await makeTempHome();
    const result = await run(["status"], { WA_HOME: temp.home });
    expect(result).toMatchObject({ code: 1 });
    expect(result.err).toContain("the wa engine is not running");
    await temp.cleanup();
  });
});

describe("against a running engine", () => {
  let temp: TempHome;
  let engine: Engine;
  let client: FakeWhatsAppClient;
  let env: Record<string, string>;

  beforeAll(async () => {
    temp = await makeTempHome();
    env = { WA_HOME: temp.home };
    engine = await startEngine(temp.config, {
      client: () => (client = new FakeWhatsAppClient(client?.user as never)),
      logger: createLogger("silent"),
    });
  });

  afterAll(async () => {
    await engine.stop();
    await temp.cleanup();
  });

  test("a second serve on the same WA_HOME is a one-line error", async () => {
    const result = await run(["serve"], env);
    expect(result).toMatchObject({ code: 1 });
    expect(result.err).toBe(
      `wa serve: another wa engine is already running on ${engine.socketPath}`,
    );
  });

  test("link shows the QR and waits for the link", async () => {
    const linking = run(["link"], env);
    while (engine.connection.status().state !== "linking") await Bun.sleep(2);
    client.showQr("2@cli-test-qr");
    await client.idle();
    while (!engine.connection.status().qr) await Bun.sleep(2);
    await Bun.sleep(20);
    client.pair(ME);
    await client.idle();
    client.open();
    await client.idle();
    const result = await linking;
    expect(result.code).toBe(0);
    expect(result.out).toContain("scan it in WhatsApp");
    expect(result.out).toContain("linked as +40700000001");

    const again = await run(["link"], env);
    expect(again.code).toBe(1);
    expect(again.err).toContain("already linked as +40700000001; use --relink");
  });

  test("status, chats, read and search", async () => {
    client.emitBatch({
      "contacts.upsert": [{ id: ANA, name: "Ana" }],
      "groups.upsert": [
        { id: GROUP, subject: "Master PP", owner: undefined, participants: [] },
        { id: OTHER_GROUP, subject: "Master Lab", owner: undefined, participants: [] },
      ],
      "messages.upsert": {
        type: "append",
        messages: [
          buildMessage({
            chat: GROUP,
            participant: ANA,
            ts: 1_700_000_000,
            message: content.text("tema la PP\nnew line"),
          }),
          buildMessage({ chat: ANA, ts: 1_700_000_100, message: content.text("salut") }),
        ],
      },
    });
    await client.idle();
    await engine.ingest.drain();

    expect((await run(["status"], env)).out).toMatch(/state\s+open/);
    expect(JSON.parse((await run(["status", "--json"], env)).out)).toMatchObject({ state: "open" });

    const listed = await run(["chats"], env);
    expect(listed.out.split("\n")[0]).toContain("Ana");
    expect(listed.out).toContain("Master PP");
    expect((await run(["chats", "lab", "--json"], env)).out).toContain(OTHER_GROUP);

    const read = await run(["read", "Master PP"], env);
    expect(read.out).toContain("Ana: tema la PP ⏎ new line");
    const ambiguous = await run(["read", "master"], env);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toContain("did you mean one of:");
    expect(ambiguous.err).toContain(GROUP);

    const found = await run(["search", "tema"], env);
    expect(found.out).toContain("Master PP");
    expect(found.out).toContain("«tema»");
    expect((await run(["search", "nothing-like-this"], env)).out).toBe("no matches");
  });

  test("collections, profiles, tokens and audit", async () => {
    expect((await run(["collections", "create", "master", "--description", "uni"], env)).code).toBe(
      0,
    );
    const added = await run(["collections", "add", "master", "Master PP", "+40 700 000 002"], env);
    expect(added.out).toContain("master — uni");
    expect(added.out).toContain(ANA);
    expect((await run(["collections", "ls"], env)).out).toMatch(/master\s+2 chats\s+uni/);
    const removed = await run(["collections", "rm", "master", "+40700000002"], env);
    expect(removed.out).not.toContain(ANA);
    expect(
      JSON.parse((await run(["collections", "show", "master", "--json"], env)).out),
    ).toMatchObject({
      chatCount: 1,
    });

    const profile = await run(
      [
        "profiles",
        "create",
        "master",
        "--caps",
        "chats:read,messages:read",
        "--collections",
        "master",
      ],
      env,
    );
    expect(profile.out).toContain("on collections master");
    expect((await run(["profiles", "ls"], env)).out).toContain("raycast (built-in)");

    const created = await run(["tokens", "create", "master", "--label", "agent"], env);
    expect(created.out).toMatch(/^wa_[\w-]{43}$/);
    expect(created.err).toContain("shown once");
    const token = created.out;
    const response = await fetch(`http://127.0.0.1:${engine.port}/v1/chats`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(((await response.json()) as { items: unknown[] }).items).toHaveLength(1);

    const id = created.err.match(/token (t_\w+)/)![1]!;
    expect((await run(["tokens", "ls", "--profile", "master"], env)).out).toMatch(/active\s+used/);
    expect((await run(["tokens", "revoke", id], env)).out).toBe(`revoked ${id}`);
    expect((await run(["tokens", "ls", "--profile", "master"], env)).out).toContain("revoked");

    const audited = await run(["audit", "--limit", "3"], env);
    expect(audited.out).toContain("token.revoke");
    expect((await run(["audit", "--profile", "nobody"], env)).out).toBe("nothing audited yet");

    expect((await run(["profiles", "delete", "raycast"], env)).code).toBe(1);
    expect((await run(["profiles", "delete", "master"], env)).code).toBe(0);
    expect((await run(["collections", "delete", "master"], env)).code).toBe(0);
    const missing = await run(["collections", "show", "master"], env);
    expect(missing).toMatchObject({ code: 1, err: "wa collections: collection not found" });
  });
});
