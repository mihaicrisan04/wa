import type { Exec } from "./exec";

export interface CommandIO {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
  /** Whether stdout is a terminal (colors, highlights). */
  isTTY?: boolean;
  /** How often `wa link` and `wa backfill` poll the engine; tests shorten it. */
  pollMs?: number;
  /** How long `wa link` follows a history sync that has gone quiet; tests shorten it. */
  historyIdleMs?: number;
  /** Runs external programs (`claude`); tests record the calls instead. */
  exec?: Exec;
  /** How a shell runs this `wa`; detected when absent. */
  waCommand?: string[];
  /** Where relative paths start; the process's cwd when absent. */
  cwd?: string;
}

export interface Command {
  name: string;
  summary: string;
  /** Hidden commands work but are left out of `wa --help`. */
  hidden?: boolean;
  /** Resolves to the process exit code. */
  run(args: string[], io: CommandIO): Promise<number>;
}

export const EXIT_USAGE = 2;
export const EXIT_FAILURE = 1;

/** A mistake in how the command was called: printed with the usage, exit 2. */
export class UsageError extends Error {}

/** An expected failure, printed as one line: exit 1. */
export class FailureError extends Error {}
