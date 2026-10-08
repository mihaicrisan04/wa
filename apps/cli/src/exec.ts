import { FailureError } from "./command";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program (no shell) and collects its output. */
export type Exec = (argv: string[], options: { cwd: string }) => Promise<ExecResult>;

class ProgramNotFoundError extends FailureError {
  constructor(readonly program: string) {
    super(`${program} was not found on PATH`);
  }
}

export const spawnExec: Exec = async (argv, { cwd }) => {
  let child: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  try {
    child = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    if (errorCode(err) === "ENOENT") throw new ProgramNotFoundError(argv[0]!);
    throw err;
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
};

/** What a failed program said, in one line for an error message. */
export function firstLine({ stdout, stderr }: ExecResult): string {
  return (stderr || stdout).trim().split("\n")[0] || "no output";
}

/** The `code` of a system or library error (`ENOENT`, `ERR_PARSE_ARGS_…`). */
export function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  return typeof err.code === "string" ? err.code : undefined;
}

/** How to run this same `wa` from a shell: the compiled binary, or bun with the entry script. */
export function waCommand(): string[] {
  // a compiled binary runs its embedded entry from Bun's virtual /$bunfs
  if (Bun.main.startsWith("/$bunfs/")) return [process.execPath];
  return [process.execPath, Bun.main];
}

/** One shell word: double-quoted (paths here contain spaces), single-quoted when that's unsafe. */
export function shellWord(value: string): string {
  if (!/["$`\\!]/.test(value)) return `"${value}"`;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
