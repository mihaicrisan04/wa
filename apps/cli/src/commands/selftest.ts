import { runSelftest } from "@wa/engine";
import type { Command } from "../command";

export const selftest: Command = {
  name: "selftest",
  summary: "check that the bundled WhatsApp libraries work (offline)",
  hidden: true,
  async run(_args, io) {
    const results = await runSelftest();
    for (const result of results) {
      const line = `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.detail ? `: ${result.detail}` : ""}`;
      (result.ok ? io.out : io.err)(line);
    }
    return results.every((result) => result.ok) ? 0 : 1;
  },
};
