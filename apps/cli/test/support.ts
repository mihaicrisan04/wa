import { runCli } from "../src/cli";
import type { CommandIO } from "../src/command";
import type { Exec, ExecResult } from "../src/exec";

export interface RunResult {
  code: number;
  out: string;
  err: string;
}

/** A running `wa` command: await it for the result, or read what it printed so far. */
export interface CliRun extends Promise<RunResult> {
  printed(): string;
  finished(): boolean;
}

/** Runs `wa <argv>` in-process; `io` fills in the env and whatever else the test needs. */
export function run(argv: string[], io: Partial<CommandIO> = {}): CliRun {
  const out: string[] = [];
  const err: string[] = [];
  let finished = false;
  const result = runCli(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env: {},
    pollMs: 5,
    ...io,
  }).then((code) => {
    finished = true;
    return { code, out: out.join("\n"), err: err.join("\n") };
  });
  return Object.assign(result, {
    printed: () => [...out, ...err].join("\n"),
    finished: () => finished,
  });
}

export const OK: ExecResult = { code: 0, stdout: "", stderr: "" };

/** Records every external program call and answers from `replies`, keyed by `argv[0] argv[1]` (then OK). */
export function recorder(replies: Partial<Record<string, ExecResult[]>> = {}) {
  const calls: { argv: string[]; cwd: string }[] = [];
  const exec: Exec = async (argv, { cwd }) => {
    calls.push({ argv, cwd });
    return replies[`${argv[0]} ${argv[1]}`]?.shift() ?? OK;
  };
  return { calls, argvs: () => calls.map((call) => call.argv), exec };
}
