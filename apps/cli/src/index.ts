#!/usr/bin/env bun
import { runCli } from "./cli";

const io = {
  out: (line: string) => console.log(line),
  err: (line: string) => console.error(line),
  env: process.env,
  isTTY: process.stdout.isTTY,
};

// exit explicitly: Baileys can leave timers behind after the engine stops
process.exit(await runCli(process.argv.slice(2), io));
