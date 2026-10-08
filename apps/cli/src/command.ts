export interface CommandIO {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
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
