import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ANA_PN,
  buildMessage,
  content,
  eventually,
  GROUP,
  makeTempHome,
  ME,
  startApi,
  type ApiHarness,
} from "@wa/engine/testing";
import { run as runWa } from "./support";

const OTHER_GROUP = "120363000000000002@g.us";
const CONNECTION_REPLACED = 440;

const run = (argv: string[], env: Record<string, string | undefined>) =>
  runWa(argv, { env, historyIdleMs: 50 });

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
    try {
      const result = await run(["status"], { WA_HOME: temp.home });
      expect(result).toMatchObject({ code: 1 });
      expect(result.err).toContain("the wa engine is not running");
      expect(result.err).toContain("`wa service install`");
    } finally {
      await temp.cleanup();
    }
  });
});

describe("wa link", () => {
  let api: ApiHarness;
  let env: Record<string, string>;

  beforeEach(async () => {
    api = await startApi({ linked: false });
    env = { WA_HOME: api.temp.home };
  });

  afterEach(() => api.stop());

  const pairingStarted = () =>
    eventually(() => api.engine.connection.status().state === "linking", "the pairing to start");

  test("shows the QR and waits for the link", async () => {
    const linking = run(["link"], env);
    await pairingStarted();
    api.client().showQr("2@cli-test-qr");
    await eventually(() => linking.printed().includes("scan it in WhatsApp"), "the QR");
    api.client().pair(ME);
    await api.client().idle();
    api.client().open();
    await api.client().idle();
    const result = await linking;
    expect(result.code).toBe(0);
    expect(result.out).toContain("scan it in WhatsApp");
    expect(result.out).toContain("linked as +40700000001");

    const again = await run(["link"], env);
    expect(again.code).toBe(1);
    expect(again.err).toContain("already linked as +40700000001; use --relink");
  });

  test("stops at once when another session takes over the pairing", async () => {
    const linking = run(["link"], env);
    await pairingStarted();
    api.client().close(CONNECTION_REPLACED);
    const result = await linking;
    expect(result.code).toBe(1);
    expect(result.err).toBe("wa link: another session took over this WhatsApp link (`wa status`)");
  });

  test("stops at once when the engine shuts down mid-link", async () => {
    const linking = run(["link"], env);
    await pairingStarted();
    // the engine's shutdown stops the connection first, while the API still answers
    await api.engine.connection.stop();
    const result = await linking;
    expect(result.code).toBe(1);
    expect(result.err).toBe(
      "wa link: the wa engine is shutting down: restart it with `wa service install` (or `wa serve` in a terminal), then run `wa link` again",
    );
  });
});

describe("against a running engine", () => {
  let api: ApiHarness;
  let env: Record<string, string>;

  beforeEach(async () => {
    api = await startApi();
    env = { WA_HOME: api.temp.home };
    await api.emit({
      "contacts.upsert": [{ id: ANA_PN, name: "Ana" }],
      "groups.upsert": [
        { id: GROUP, subject: "Master PP", owner: undefined, participants: [] },
        { id: OTHER_GROUP, subject: "Master Lab", owner: undefined, participants: [] },
      ],
      "messages.upsert": {
        type: "append",
        messages: [
          buildMessage({
            chat: GROUP,
            participant: ANA_PN,
            ts: 1_700_000_000,
            message: content.text("tema la PP\nnew line"),
          }),
          buildMessage({ chat: ANA_PN, ts: 1_700_000_100, message: content.text("salut") }),
        ],
      },
    });
  });

  afterEach(() => api.stop());

  test("a second serve on the same WA_HOME is a one-line error", async () => {
    const result = await run(["serve"], env);
    expect(result).toMatchObject({ code: 1 });
    expect(result.err).toBe(
      `wa serve: another wa engine is already running on ${api.engine.socketPath}`,
    );
  });

  test("status, chats, read and search", async () => {
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
    expect(added.out).toContain(ANA_PN);
    expect((await run(["collections", "ls"], env)).out).toMatch(/master\s+2 chats\s+uni/);
    const removed = await run(["collections", "rm", "master", "+40700000002"], env);
    expect(removed.out).not.toContain(ANA_PN);
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
    const response = await api.http("/v1/chats", token);
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
