import { runSelftest } from "@wa/engine";
import { EXIT_FAILURE } from "../command";
import { defineCommand } from "../define";

export const selftest = defineCommand({
  name: "selftest",
  summary: "check that the bundled WhatsApp libraries work (offline)",
  usage: "wa selftest",
  hidden: true,
  async run(_input, io) {
    const results = await runSelftest();
    for (const result of results) {
      const line = `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.detail ? `: ${result.detail}` : ""}`;
      (result.ok ? io.out : io.err)(line);
    }
    return results.every((result) => result.ok) ? 0 : EXIT_FAILURE;
  },
});
