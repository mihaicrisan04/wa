import { describe, expect, test } from "bun:test";
import { defaultHome, raycastTokenPath } from "@wa/sdk";
import { ConfigError, DEFAULT_PORT, loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("defaults to the macOS data dir, port 7373 and info logs", () => {
    const config = loadConfig({});
    expect(config).toEqual({
      home: defaultHome(),
      host: "127.0.0.1",
      port: DEFAULT_PORT,
      logLevel: "info",
    });
    expect(DEFAULT_PORT).toBe(7373);
    expect(config.home).toEndWith("/Library/Application Support/wa");
  });

  test("reads WA_HOME, WA_PORT and WA_LOG_LEVEL", () => {
    const config = loadConfig({ WA_HOME: "/tmp/wa home", WA_PORT: "0", WA_LOG_LEVEL: "debug" });
    expect(config).toMatchObject({ home: "/tmp/wa home", port: 0, logLevel: "debug" });
  });

  test("treats empty variables as unset", () => {
    expect(loadConfig({ WA_HOME: "", WA_PORT: "" })).toMatchObject({
      home: defaultHome(),
      port: DEFAULT_PORT,
    });
  });

  test.each([
    ["WA_PORT", "70000"],
    ["WA_PORT", "abc"],
    ["WA_LOG_LEVEL", "loud"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
  });
});

describe("@wa/sdk paths", () => {
  test("the default home sits under the user's Application Support", () => {
    expect(defaultHome("/Users/me")).toBe("/Users/me/Library/Application Support/wa");
  });

  test("the raycast token lives in WA_HOME/tokens", () => {
    expect(raycastTokenPath("/tmp/wa home")).toBe("/tmp/wa home/tokens/raycast.token");
  });
});
