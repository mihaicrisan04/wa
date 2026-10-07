import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { startEngine } from "../src/engine";
import {
  FakeWhatsAppClient,
  makeTempHome,
  ME,
  ME_PN,
  silentLogger,
  type TempHome,
} from "../src/testing";

let temp: TempHome;

beforeEach(async () => {
  temp = await makeTempHome();
});

afterEach(() => temp.cleanup());

/** `d700` for a directory, `600` for anything else. */
async function modesUnder(dir: string): Promise<Record<string, string>> {
  const modes: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true })) {
    const info = await stat(join(dir, entry));
    modes[entry] = `${info.isDirectory() ? "d" : ""}${(info.mode & 0o777).toString(8)}`;
  }
  return modes;
}

test("everything the engine creates is 0600 files and 0700 dirs", async () => {
  await chmod(temp.home, 0o755);
  const client = new FakeWhatsAppClient();
  const engine = await startEngine(temp.config, { client, logger: silentLogger });
  let modes: Record<string, string>;
  try {
    await engine.connection.link();
    client.pair(ME);
    await client.idle();
    // not open yet, so the upload waits in WA_HOME/outbox
    await engine.outbox.enqueue(
      ME_PN,
      {
        kind: "file",
        bytes: new Uint8Array([1]),
        fileName: "a.txt",
        mimetype: null,
        caption: null,
      },
      null,
    );
    modes = await modesUnder(temp.home);
  } finally {
    await engine.stop();
  }

  expect(((await stat(temp.home)).mode & 0o777).toString(8)).toBe("700");

  expect(modes["auth"]).toBe("d700");
  expect(modes[join("auth", "creds.json")]).toBe("600");
  expect(modes["engine.sock"]).toBe("600");
  expect(modes[join("tokens", "raycast.token")]).toBe("600");
  expect(Object.keys(modes).filter((path) => path.startsWith("outbox/"))).toHaveLength(1);
  for (const [path, mode] of Object.entries(modes)) {
    expect(`${path} ${mode}`).toBe(`${path} ${mode.startsWith("d") ? "d700" : "600"}`);
  }
});
