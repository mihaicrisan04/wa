import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineConfig } from "../config";

export interface TempHome {
  home: string;
  config: EngineConfig;
  cleanup(): Promise<void>;
}

/** A throwaway WA_HOME on an ephemeral port; never the real data directory. */
export async function makeTempHome(): Promise<TempHome> {
  const home = await mkdtemp(join(tmpdir(), "wa test "));
  return {
    home,
    config: { home, host: "127.0.0.1", port: 0, logLevel: "silent" },
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}
