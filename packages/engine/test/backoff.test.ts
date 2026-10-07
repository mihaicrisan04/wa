import { expect, test } from "bun:test";
import { backoffDelay, DEFAULT_BACKOFF } from "../src/backoff";

test("backoff doubles from the base on every attempt and stops at the cap", () => {
  const delays = [1, 2, 3, 4, 5].map((attempt) => backoffDelay({ baseMs: 5, maxMs: 30 }, attempt));
  expect(delays).toEqual([5, 10, 20, 30, 30]);
});

test("the default backoff waits a second at first and a minute at most", () => {
  expect(backoffDelay(DEFAULT_BACKOFF, 1)).toBe(1_000);
  expect(backoffDelay(DEFAULT_BACKOFF, 100)).toBe(60_000);
});
