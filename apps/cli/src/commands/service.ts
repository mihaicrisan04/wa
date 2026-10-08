import { positiveInt } from "../args";
import { defineGroup, defineSubcommand } from "../define";
import { installService, serviceLogs, serviceStatus, uninstallService } from "../service/manage";

const DEFAULT_LOG_LINES = 50;

const INSTALL_NOTE = `install copies this binary to ~/.local/bin/wa and runs \`wa serve\` as the launchd
agent com.mihaicrisan.wa (at login, restarted when it exits, logs in
~/Library/Logs/wa/engine.log). WA_HOME, WA_PORT and WA_LOG_LEVEL set while
installing are kept for the service.`;

export const service = defineGroup({
  name: "service",
  summary: "run the engine in the background with launchd",
  notes: INSTALL_NOTE,
  subcommands: {
    install: defineSubcommand({
      usage: "wa service install",
      description: INSTALL_NOTE,
      run: (_input, io) => installService(io),
    }),
    uninstall: defineSubcommand({
      usage: "wa service uninstall",
      run: (_input, io) => uninstallService(io),
    }),
    status: defineSubcommand({
      usage: "wa service status",
      run: (_input, io) => serviceStatus(io),
    }),
    logs: defineSubcommand({
      usage: "wa service logs [-n lines] [-f]",
      options: {
        lines: { type: "string", short: "n" },
        follow: { type: "boolean", short: "f" },
      },
      run: ({ values }, io) =>
        serviceLogs(io, {
          lines: positiveInt(values.lines, "--lines") ?? DEFAULT_LOG_LINES,
          follow: values.follow ?? false,
        }),
    }),
  },
});
