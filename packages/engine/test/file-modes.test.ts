import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { startEngine } from "../src/engine";
import { FakeWhatsAppClient, makeTempHome, type TempHome } from "../src/testing";

let temp: TempHome;

beforeEach(async () => {
  temp = await makeTempHome();
});

afterEach(() => temp.cleanup());

async function modesUnder(dir: string): Promise<Record<string, string>> {
  const modes: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true })) {
    const info = await stat(join(dir, entry));
    modes[entry] = (info.mode & 0o777).toString(8);
  }
  return modes;
}

test("everything the engine creates is 0600 files and 0700 dirs", async () => {
  await chmod(temp.home, 0o755);
  const client = new FakeWhatsAppClient();
  const engine = await startEngine(temp.config, { client, logger: pino({ level: "silent" }) });
  await engine.connection.link();
  client.pair({ id: "40700000001:7@s.whatsapp.net" });
  await client.idle();
  await engine.stop();

  expect(((await stat(temp.home)).mode & 0o777).toString(8)).toBe("700");
  const modes = await modesUnder(temp.home);
  expect(modes["auth"]).toBe("700");
  expect(modes[join("auth", "creds.json")]).toBe("600");
  for (const [path, mode] of Object.entries(modes)) {
    const isDir = (await stat(join(temp.home, path))).isDirectory();
    expect(`${path} ${mode}`).toBe(`${path} ${isDir ? "700" : "600"}`);
  }
});
