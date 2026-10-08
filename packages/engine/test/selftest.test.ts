import { expect, test } from "bun:test";
import { runSelftest } from "../src/selftest";

test("selftest passes from source", async () => {
  const results = await runSelftest();
  expect(results.length).toBeGreaterThan(0);
  expect(results.filter((result) => !result.ok)).toEqual([]);
});
