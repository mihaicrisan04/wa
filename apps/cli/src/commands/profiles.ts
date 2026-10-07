import { parseArgs } from "node:util";
import { PROFILE_CAPABILITIES, type ProfileCapability } from "@wa/sdk";
import { UsageError, type Command } from "../command";
import { engineClient } from "../engine-client";
import { json, table } from "../output";
import { csv, dispatch, expect } from "../subcommands";

const USAGE = `usage:
  wa profiles ls [--json]
  wa profiles create <name> --caps a,b [--collections x,y | --all-chats]
  wa profiles delete <name>

capabilities: ${PROFILE_CAPABILITIES.join(", ")}`;

export const profiles: Command = {
  name: "profiles",
  summary: "capabilities + chat scope that tokens are bound to",
  run: (args, io) =>
    dispatch(
      "profiles",
      USAGE,
      {
        async ls(rest) {
          const { values } = parseArgs({ args: rest, options: { json: { type: "boolean" } } });
          const list = await engineClient(io.env).admin.profiles.list();
          if (values.json) {
            io.out(json(list));
            return 0;
          }
          const rows = list.map((profile) => [
            profile.builtin ? `${profile.name} (built-in)` : profile.name,
            profile.allChats
              ? "all chats"
              : `collections: ${profile.collections.join(", ") || "none"}`,
            profile.capabilities.join(","),
          ]);
          for (const line of table(rows)) io.out(line);
          return 0;
        },
        async create(rest) {
          const { values, positionals } = parseArgs({
            args: rest,
            options: {
              caps: { type: "string" },
              collections: { type: "string" },
              "all-chats": { type: "boolean" },
            },
            allowPositionals: true,
            strict: true,
          });
          const [name] = expect(positionals, ["name"], USAGE);
          const capabilities = csv(values.caps);
          if (!capabilities.length) throw new UsageError(`--caps is required\n\n${USAGE}`);
          const unknown = capabilities.filter(
            (cap) => !(PROFILE_CAPABILITIES as readonly string[]).includes(cap),
          );
          if (unknown.length)
            throw new UsageError(`unknown capability: ${unknown.join(", ")}\n\n${USAGE}`);
          const collections = csv(values.collections);
          if (collections.length && values["all-chats"]) {
            throw new UsageError("give either --collections or --all-chats, not both");
          }
          const profile = await engineClient(io.env).admin.profiles.create({
            name: name!,
            capabilities: capabilities as ProfileCapability[],
            collections,
            allChats: values["all-chats"] ?? false,
          });
          const scope = profile.allChats
            ? "all chats"
            : `collections ${profile.collections.join(", ") || "(none)"}`;
          io.out(`created profile ${profile.name}: ${profile.capabilities.join(", ")} on ${scope}`);
          io.out(`next: wa tokens create ${profile.name}`);
          return 0;
        },
        async delete(rest) {
          const [name] = expect(
            parseArgs({ args: rest, allowPositionals: true }).positionals,
            ["name"],
            USAGE,
          );
          await engineClient(io.env).admin.profiles.delete(name!);
          io.out(`deleted profile ${name} and revoked its tokens`);
          return 0;
        },
      },
      args,
      io,
    ),
};
