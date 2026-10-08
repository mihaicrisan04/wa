import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PORT, engineUrl, WaApiError } from "@wa/sdk";
import { describeError } from "../src/lib/errors";
import { MissingTokenError, parsePort, raycastTokenPath, resolveToken } from "../src/lib/settings";
import { tempDir } from "./support";

let home: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: home, cleanup } = await tempDir());
});
afterEach(() => cleanup());

async function writeEngineToken(token: string) {
  await mkdir(join(home, "tokens"), { recursive: true });
  await writeFile(raycastTokenPath(home), token);
}

describe("token", () => {
  test("the preference wins over the engine's file", async () => {
    await writeEngineToken("wa_from_file\n");
    expect(await resolveToken("  wa_from_pref ", home)).toBe("wa_from_pref");
  });

  test("an empty preference falls back to tokens/raycast.token in WA_HOME", async () => {
    await writeEngineToken("wa_from_file\n");
    expect(raycastTokenPath(home)).toBe(join(home, "tokens", "raycast.token"));
    expect(await resolveToken("", home)).toBe("wa_from_file");
    expect(await resolveToken("   ", home)).toBe("wa_from_file");
    expect(await resolveToken(undefined, home)).toBe("wa_from_file");
  });

  test("the file is read fresh, so a token the engine rotated is picked up", async () => {
    await writeEngineToken("wa_old");
    expect(await resolveToken(undefined, home)).toBe("wa_old");
    await writeEngineToken("wa_new");
    expect(await resolveToken(undefined, home)).toBe("wa_new");
  });

  test("no preference and no file is a MissingTokenError", async () => {
    const error = await resolveToken(undefined, home).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MissingTokenError);
    await writeEngineToken("\n");
    expect(await resolveToken(undefined, home).catch((err: unknown) => err)).toBeInstanceOf(
      MissingTokenError,
    );
  });
});

describe("port", () => {
  test("anything but a valid port number falls back to the default", () => {
    expect(parsePort("7400")).toBe(7400);
    expect(parsePort(" 7400 ")).toBe(7400);
    for (const bad of [undefined, "", "abc", "0", "-1", "70000", "73.5"]) {
      expect(parsePort(bad)).toBe(DEFAULT_PORT);
    }
  });

  test("the engine is always reached on loopback by IP, which its Host guard accepts", () => {
    expect(engineUrl(7373)).toBe("http://127.0.0.1:7373");
  });
});

describe("error descriptions", () => {
  test("engine not running", () => {
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    expect(describeError(refused, 7373)).toEqual({
      title: "wa engine isn't running",
      message: expect.stringContaining("127.0.0.1:7373"),
    });
  });

  test("a connection cut mid-request is not reported as a stopped engine", () => {
    for (const code of ["EPIPE", "ECONNRESET", undefined]) {
      const cut = new TypeError("fetch failed", {
        cause: Object.assign(new Error("socket hang up"), { code }),
      });
      expect(describeError(cut, 7373)).toMatchObject({
        title: "Lost the connection to the wa engine",
        message: expect.stringContaining("cut off"),
      });
    }
  });

  test("files over WhatsApp's cap say so", () => {
    const error = new WaApiError(413, "too_large", "WhatsApp only takes files up to 2 GB");
    expect(describeError(error, 7373)).toEqual({
      title: "File too large",
      message: "WhatsApp only takes files up to 2 GB.",
    });
  });

  test("timeouts", () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    expect(describeError(timeout, 7373).title).toBe("wa engine didn't answer");
  });

  test("missing and rejected tokens point at the preference", () => {
    expect(describeError(new MissingTokenError("/x/raycast.token"), 1).title).toBe("No wa token");
    const rejected = new WaApiError(401, "unauthorized", "a valid bearer token is required");
    expect(describeError(rejected, 1)).toMatchObject({
      title: "Token rejected",
      message: expect.stringContaining("Token preference"),
    });
  });

  test("not linked sends the user to Link WhatsApp", () => {
    const error = new WaApiError(409, "not_linked", "WhatsApp is not linked yet");
    expect(describeError(error, 1)).toEqual({
      title: "WhatsApp isn't linked",
      message: "Run Link WhatsApp first.",
    });
  });

  test("other engine errors keep the engine's message", () => {
    const error = new WaApiError(403, "forbidden", "this token can only send to yourself");
    expect(describeError(error, 1)).toEqual({
      title: "wa engine error",
      message: "this token can only send to yourself",
    });
    expect(describeError("boom", 1)).toEqual({ title: "Something went wrong", message: "boom" });
  });
});
