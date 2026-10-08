import { PROFILE_CAPABILITIES, type ProfileCapability } from "@wa/sdk";
import { csv, isOneOf } from "../args";
import { UsageError } from "../command";
import { defineGroup, defineSubcommand } from "../define";
import { engineClient } from "../engine-client";
import { json, table } from "../output";

const CAPABILITIES_NOTE = `capabilities: ${PROFILE_CAPABILITIES.join(", ")}`;

export const profiles = defineGroup({
  name: "profiles",
  summary: "capabilities + chat scope that tokens are bound to",
  notes: CAPABILITIES_NOTE,
  subcommands: {
    ls: defineSubcommand({
      usage: "wa profiles ls [--json]",
      options: { json: { type: "boolean" } },
      async run({ values }, io) {
        const listed = await engineClient(io.env).admin.profiles.list();
        if (values.json) {
          io.out(json(listed));
          return 0;
        }
        const rows = listed.items.map((profile) => [
          profile.builtin ? `${profile.name} (built-in)` : profile.name,
          profile.allChats
            ? "all chats"
            : `collections: ${profile.collections.join(", ") || "none"}`,
          profile.capabilities.join(","),
        ]);
        for (const line of table(rows)) io.out(line);
        return 0;
      },
    }),
    create: defineSubcommand({
      usage: "wa profiles create <name> --caps a,b [--collections x,y | --all-chats]",
      description: CAPABILITIES_NOTE,
      options: {
        caps: { type: "string" },
        collections: { type: "string" },
        "all-chats": { type: "boolean" },
      },
      positionals: ["name"],
      async run({ values, positionals: [name], help }, io) {
        const caps = csv(values.caps);
        if (!caps.length) throw new UsageError(`--caps is required\n\n${help}`);
        const capabilities: ProfileCapability[] = [];
        const unknown: string[] = [];
        for (const cap of caps) {
          if (isOneOf(cap, PROFILE_CAPABILITIES)) capabilities.push(cap);
          else unknown.push(cap);
        }
        if (unknown.length) {
          throw new UsageError(`unknown capability: ${unknown.join(", ")}\n\n${help}`);
        }
        const collections = csv(values.collections);
        if (collections.length && values["all-chats"]) {
          throw new UsageError("give either --collections or --all-chats, not both");
        }
        const profile = await engineClient(io.env).admin.profiles.create({
          name,
          capabilities,
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
    }),
    delete: defineSubcommand({
      usage: "wa profiles delete <name>",
      positionals: ["name"],
      async run({ positionals: [name] }, io) {
        await engineClient(io.env).admin.profiles.delete(name);
        io.out(`deleted profile ${name} and revoked its tokens`);
        return 0;
      },
    }),
  },
});
