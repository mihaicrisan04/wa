import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import {
  eventually,
  FakeWhatsAppClient,
  makeTempHome,
  ME,
  ME_LID,
  ME_PN,
  silentLogger,
  type TempHome,
} from "../src/testing";
import type { Logger } from "../src/logger";
import {
  AlreadyLinkedError,
  PREVIOUS_AUTH_DIR,
  WhatsAppConnection,
  type ConnectionOptions,
} from "../src/whatsapp/connection";

type CreateClient = ConnectionOptions["createClient"];

let temp: TempHome;
let clients: FakeWhatsAppClient[];
let connection: WhatsAppConnection;

function newFakeClient(): FakeWhatsAppClient {
  const client = new FakeWhatsAppClient();
  clients.push(client);
  return client;
}

function newConnection(
  createClient: CreateClient = newFakeClient,
  logger: Logger = silentLogger,
): WhatsAppConnection {
  return new WhatsAppConnection({
    home: temp.home,
    logger,
    createClient,
    backoff: { baseMs: 5, maxMs: 20 },
  });
}

const latest = () => clients.at(-1)!;
const authDir = () => join(temp.home, "auth");

/** Earlier links' credentials, kept inside auth/ so its Time Machine exclusion covers them. */
async function previousLinks(): Promise<string[]> {
  return readdir(join(authDir(), PREVIOUS_AUTH_DIR)).catch(() => []);
}

const BACKUP_EXCLUSION = "com.apple.metadata:com_apple_backup_excludeItem";

/** What `tmutil addexclusion` leaves behind: an extended attribute on the directory itself. */
function markExcluded(dir: string): void {
  Bun.spawnSync(["xattr", "-w", BACKUP_EXCLUSION, "com.apple.backupd", dir]);
}

function isMarkedExcluded(dir: string): boolean {
  return Bun.spawnSync(["xattr", "-p", BACKUP_EXCLUSION, dir]).exitCode === 0;
}

async function settle(): Promise<void> {
  for (const client of clients) await client.idle();
}

/** Links through the QR flow: pairing stores creds, then WhatsApp asks for a restart. */
async function linkAndOpen(): Promise<void> {
  await connection.link();
  latest().pair(ME);
  await settle();
  latest().open();
  await settle();
}

/** A logger that records the delay of every scheduled reconnect. */
function reconnectLogger(delays: number[]): Logger {
  return pino(
    { level: "info" },
    {
      write(line: string) {
        const entry = JSON.parse(line) as { msg: string; delay?: number };
        if (entry.msg === "reconnecting to WhatsApp") delays.push(entry.delay!);
      },
    },
  );
}

beforeEach(async () => {
  temp = await makeTempHome();
  clients = [];
  connection = newConnection();
});

afterEach(async () => {
  await connection.stop();
  await temp.cleanup();
});

describe("starting", () => {
  test("stays idle and unlinked without credentials", async () => {
    await connection.start();
    expect(connection.status()).toMatchObject({ state: "not_linked", qr: null, me: null });
    expect(clients).toHaveLength(0);
  });

  test("connects right away once linked", async () => {
    await connection.start();
    await linkAndOpen();
    await connection.stop();

    connection = newConnection();
    await connection.start();
    expect(connection.status().state).toBe("connecting");
    expect(connection.me()).toEqual({ pn: ME_PN, lid: ME_LID });
  });
});

describe("linking", () => {
  beforeEach(() => connection.start());

  test("surfaces the QR while pairing", async () => {
    await connection.link();
    latest().showQr("2@qr-one");
    await settle();
    expect(connection.status()).toMatchObject({ state: "linking", qr: "2@qr-one" });
  });

  test("pairing persists creds, restarts and opens", async () => {
    let opened = 0;
    connection.onOpen(() => {
      opened++;
    });
    await linkAndOpen();

    expect(clients).toHaveLength(2);
    expect(clients[0]!.ended).toBe(true);
    expect(connection.status()).toMatchObject({ state: "open", qr: null });
    expect(connection.me()).toEqual({ pn: ME_PN, lid: ME_LID });
    expect(opened).toBe(1);
    const creds = await Bun.file(join(temp.home, "auth", "creds.json")).json();
    expect(creds.me.id).toBe(ME.id);
  });

  test("a QR timeout leaves it unlinked and idle", async () => {
    await connection.link();
    latest().close(DisconnectReason.timedOut);
    await settle();
    await Bun.sleep(30);
    expect(connection.status().state).toBe("not_linked");
    expect(clients).toHaveLength(1);
  });

  test("refuses to link again unless relinking", async () => {
    await linkAndOpen();
    await expect(connection.link()).rejects.toBeInstanceOf(AlreadyLinkedError);

    await connection.link({ relink: true });
    expect(connection.status().state).toBe("linking");
    expect(connection.isLinked()).toBe(false);
    expect(await previousLinks()).toEqual([expect.stringMatching(/^relinked-/)]);
    const [previous] = await previousLinks();
    const moved = await Bun.file(
      join(authDir(), PREVIOUS_AUTH_DIR, previous!, "creds.json"),
    ).json();
    expect(moved.me.id).toBe(ME.id);
  });

  test("relinking keeps the auth directory itself, so its backup exclusion stays", async () => {
    await linkAndOpen();
    const before = await stat(authDir());
    if (process.platform === "darwin") markExcluded(authDir());

    await connection.link({ relink: true });
    latest().pair(ME);
    await settle();
    expect(connection.isLinked()).toBe(true);
    expect((await stat(authDir())).ino).toBe(before.ino);
    if (process.platform === "darwin") expect(isMarkedExcluded(authDir())).toBe(true);
    expect(await Bun.file(join(authDir(), "creds.json")).exists()).toBe(true);
  });
});

describe("disconnects", () => {
  beforeEach(async () => {
    await connection.start();
    await linkAndOpen();
  });

  test("fetches groups once on open", async () => {
    const updates: unknown[] = [];
    latest().ev.on("groups.update", (groups) => updates.push(groups));
    latest().open();
    await settle();
    expect(updates).toHaveLength(1);
  });

  test("401 logged out moves credentials aside and waits for a new link", async () => {
    const before = await stat(authDir());
    latest().close(DisconnectReason.loggedOut);
    await settle();

    expect(connection.status().state).toBe("needs_link");
    expect(connection.isLinked()).toBe(false);
    expect(connection.me()).toBeNull();
    expect(await previousLinks()).toEqual([expect.stringMatching(/^logged-out-/)]);
    expect((await stat(authDir())).ino).toBe(before.ino);
    expect(await Bun.file(join(authDir(), "creds.json")).exists()).toBe(false);
    await Bun.sleep(30);
    expect(clients).toHaveLength(2);
  });

  test("440 connection replaced never reconnects", async () => {
    latest().close(DisconnectReason.connectionReplaced);
    await settle();
    await Bun.sleep(30);
    expect(connection.status()).toMatchObject({ state: "replaced", lastDisconnect: { code: 440 } });
    expect(clients).toHaveLength(2);
  });

  test("the last disconnect is stamped in unix seconds, like every other timestamp", async () => {
    const before = Math.floor(Date.now() / 1000);
    latest().close(DisconnectReason.restartRequired);
    await settle();
    const at = connection.status().lastDisconnect?.at ?? 0;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000));
  });

  test("515 restart required reconnects immediately", async () => {
    latest().close(DisconnectReason.restartRequired);
    await settle();
    expect(clients).toHaveLength(3);
    expect(connection.status().state).toBe("connecting");
  });

  test("other errors reconnect with backoff and end the old socket", async () => {
    const old = latest();
    latest().close(DisconnectReason.connectionLost);
    await settle();
    expect(connection.status().state).toBe("reconnecting");
    expect(old.ended).toBe(true);

    await eventually(() => clients.length === 3, "the reconnect");
    expect(connection.status().state).toBe("connecting");
    latest().open();
    await settle();
    expect(connection.status().state).toBe("open");
  });

  test("reconnect delays double up to the cap and start over once connected", async () => {
    const delays: number[] = [];
    await connection.stop();
    connection = newConnection(newFakeClient, reconnectLogger(delays));
    await connection.start();
    for (const reconnects of [1, 2, 3, 4]) {
      latest().close(DisconnectReason.connectionLost);
      await settle();
      await eventually(() => delays.length === reconnects, "the reconnect to be scheduled");
      await eventually(() => connection.status().state === "connecting", "the reconnect");
    }
    latest().open();
    await settle();
    latest().close(DisconnectReason.connectionLost);
    await settle();
    await eventually(() => delays.length === 5, "the reconnect after opening");
    expect(delays).toEqual([5, 10, 20, 20, 5]);
  });

  test("events from a retired socket are ignored", async () => {
    const old = latest();
    old.close(DisconnectReason.restartRequired);
    await settle();
    old.close(DisconnectReason.loggedOut);
    await settle();
    expect(connection.isLinked()).toBe(true);
  });

  test("stop ends the socket and cancels reconnects", async () => {
    latest().close(DisconnectReason.connectionLost);
    await settle();
    await connection.stop();
    await Bun.sleep(40);
    expect(connection.status().state).toBe("stopped");
    expect(clients).toHaveLength(2);
  });
});

describe("socket creation failures", () => {
  let attempts: Array<{ resolve: () => void; reject: (err: Error) => void }>;

  /** Each socket creation waits until the test resolves or rejects it. */
  function controlledFactory(): CreateClient {
    return () =>
      new Promise<FakeWhatsAppClient>((resolve, reject) => {
        attempts.push({ resolve: () => resolve(newFakeClient()), reject });
      });
  }

  beforeEach(async () => {
    attempts = [];
    connection = newConnection(controlledFactory());
    await connection.start();
  });

  test("a failure after stop does not reconnect", async () => {
    const linking = connection.link();
    await eventually(() => attempts.length === 1, "the first attempt");
    await connection.stop();
    attempts[0]!.reject(new Error("socket failed"));
    await linking;
    await Bun.sleep(40);

    expect(connection.status().state).toBe("stopped");
    expect(attempts).toHaveLength(1);
    expect(clients).toHaveLength(0);
  });

  test("a creation that finishes after stop is ended right away", async () => {
    const linking = connection.link();
    await eventually(() => attempts.length === 1, "the first attempt");
    await connection.stop();
    attempts[0]!.resolve();
    await linking;

    expect(connection.client()).toBeNull();
    expect(clients[0]!.ended).toBe(true);
  });

  test("a failed linking attempt retries as linking", async () => {
    const linking = connection.link();
    await eventually(() => attempts.length === 1, "the first attempt");
    attempts[0]!.reject(new Error("socket failed"));
    await linking;
    expect(connection.status().state).toBe("reconnecting");

    await eventually(() => attempts.length === 2, "the retry");
    expect(connection.status().state).toBe("linking");
    attempts[1]!.resolve();
    await eventually(() => connection.client() !== null, "the socket");
    latest().showQr("2@qr-retry");
    await settle();
    expect(connection.status()).toMatchObject({ state: "linking", qr: "2@qr-retry" });
  });
});
