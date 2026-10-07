export interface CommandIO {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
  /** Whether stdout is a terminal (colors, highlights). */
  isTTY?: boolean;
  /** How often `wa link` polls the engine; tests shorten it. */
  pollMs?: number;
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
