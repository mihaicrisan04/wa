import { parseArgs } from "node:util";
import { UsageError, type Command } from "../command";
import { installService, serviceLogs, serviceStatus, uninstallService } from "../service/manage";
import { dispatch } from "../subcommands";
import { positiveInt } from "./chats";

const USAGE = `usage:
  wa service install
  wa service uninstall
  wa service status
  wa service logs [-n lines] [-f]

install copies this binary to ~/.local/bin/wa and runs \`wa serve\` as the launchd
agent com.mihaicrisan.wa (at login, restarted when it exits, logs in
~/Library/Logs/wa/engine.log). WA_HOME, WA_PORT and WA_LOG_LEVEL set while
installing are kept for the service.`;

const DEFAULT_LOG_LINES = 50;

/** These subcommands take no arguments. */
function noArgs(rest: string[]): void {
  if (rest.length) throw new UsageError(`unexpected "${rest[0]}"\n\n${USAGE}`);
}

export const service: Command = {
  name: "service",
  summary: "run the engine in the background with launchd",
  run: (args, io) =>
    dispatch(
      "service",
      USAGE,
      {
        async install(rest) {
          noArgs(rest);
          return installService(io);
        },
        async uninstall(rest) {
          noArgs(rest);
          return uninstallService(io);
        },
        async status(rest) {
          noArgs(rest);
          return serviceStatus(io);
        },
        async logs(rest) {
          const { values } = parseArgs({
            args: rest,
            options: {
              lines: { type: "string", short: "n" },
              follow: { type: "boolean", short: "f" },
            },
            strict: true,
          });
          return serviceLogs(io, {
            lines: positiveInt(values.lines, "--lines") ?? DEFAULT_LOG_LINES,
            follow: values.follow ?? false,
          });
        },
      },
      args,
      io,
    ),
};
