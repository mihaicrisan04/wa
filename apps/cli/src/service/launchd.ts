import { join } from "node:path";

export const SERVICE_LABEL = "com.mihaicrisan.wa";

/** Where the installed service lives, all under the user's home. */
export interface ServicePaths {
  binary: string;
  plist: string;
  logFile: string;
}

export function servicePaths(userHome: string): ServicePaths {
  return {
    binary: join(userHome, ".local", "bin", "wa"),
    plist: join(userHome, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`),
    logFile: join(userHome, "Library", "Logs", "wa", "engine.log"),
  };
}

/** The engine settings a service keeps from the shell that installed it. */
export const SERVICE_ENV_KEYS = ["WA_HOME", "WA_PORT", "WA_LOG_LEVEL"] as const;

export interface PlistOptions {
  binary: string;
  logFile: string;
  env: Partial<Record<(typeof SERVICE_ENV_KEYS)[number], string>>;
}

const escapeXml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const string = (value: string) => `<string>${escapeXml(value)}</string>`;

/** A launchd agent running `wa serve` at login, restarted whenever it exits. */
export function servicePlist({ binary, logFile, env }: PlistOptions): string {
  const variables = SERVICE_ENV_KEYS.filter((key) => env[key]).map(
    (key) => `    <key>${key}</key>\n    ${string(env[key]!)}`,
  );
  const environment = variables.length
    ? `  <key>EnvironmentVariables</key>\n  <dict>\n${variables.join("\n")}\n  </dict>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${string(SERVICE_LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${string(binary)}
    ${string("serve")}
  </array>
${environment}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>Umask</key>
  <integer>${0o077}</integer>
  <key>StandardOutPath</key>
  ${string(logFile)}
  <key>StandardErrorPath</key>
  ${string(logFile)}
</dict>
</plist>
`;
}

const target = (uid: number) => `gui/${uid}/${SERVICE_LABEL}`;

export function bootstrapCommand(uid: number, plist: string): string[] {
  return ["launchctl", "bootstrap", `gui/${uid}`, plist];
}

export function bootoutCommand(uid: number): string[] {
  return ["launchctl", "bootout", target(uid)];
}

export function printCommand(uid: number): string[] {
  return ["launchctl", "print", target(uid)];
}

/** Sticky Time Machine exclusion: the WhatsApp keys never end up in a backup. */
export function excludeFromBackupCommand(path: string): string[] {
  return ["tmutil", "addexclusion", path];
}

export interface ServiceState {
  state: string;
  pid: number | null;
  lastExit: string | null;
}

/** The service's own top-level fields from `launchctl print` (one tab deep). */
export function parseLaunchctlPrint(output: string): ServiceState {
  const fields = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^\t([a-z][a-z ]*?) = (.*)$/.exec(line);
    if (match && !fields.has(match[1]!)) fields.set(match[1]!, match[2]!.trim());
  }
  const pid = Number(fields.get("pid"));
  return {
    state: fields.get("state") ?? "unknown",
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    lastExit: fields.get("last exit code") ?? null,
  };
}
