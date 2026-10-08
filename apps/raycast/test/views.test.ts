import { describe, expect, test } from "bun:test";
import { isFinal, linkStep, type ConnectionState, type HistorySync, type Status } from "@wa/sdk";
import { linkMarkdown } from "../src/lib/link-flow";
import { statusMarkdown, statusRows } from "../src/lib/status-view";
import { PEER } from "./support";

describe("link flow", () => {
  const step = (state: ConnectionState, qr: string | null = null, started = false) =>
    linkStep({ state, qr }, started).kind;

  test("nothing linked: start pairing once, then a stop means the QR expired", () => {
    expect(step("not_linked")).toBe("start");
    expect(step("needs_link")).toBe("start");
    expect(step("not_linked", null, true)).toBe("stopped");
    expect(step("needs_link", null, true)).toBe("stopped");
  });

  test("pairing shows each QR code, then connecting, then linked", () => {
    expect(step("linking", null, true)).toBe("waiting");
    expect(linkStep({ state: "linking", qr: "2@abc" }, true)).toEqual({ kind: "qr", qr: "2@abc" });
    expect(step("connecting", null, true)).toBe("connecting");
    expect(step("reconnecting")).toBe("connecting");
    expect(step("open")).toBe("linked");
  });

  test("polling stops once linked, stopped, replaced or the engine stops", () => {
    const final = (["open", "replaced", "stopped"] as const).map((state) =>
      isFinal(linkStep({ state, qr: null }, true)),
    );
    expect(final).toEqual([true, true, true]);
    expect(isFinal({ kind: "stopped" })).toBe(true);
    expect(isFinal({ kind: "qr", qr: "x" })).toBe(false);
    expect(isFinal({ kind: "connecting" })).toBe(false);
  });

  test("the QR image is shown at a fixed height; the linked view names the number", () => {
    const qr = linkMarkdown({ kind: "qr", qr: "2@abc" }, { qrImage: "data:image/png;base64,AAA" });
    expect(qr).toContain("![QR code](data:image/png;base64,AAA?raycast-height=350)");
    expect(linkMarkdown({ kind: "linked" }, { me: PEER })).toContain("**\\+40700000002**");
    expect(linkMarkdown({ kind: "linked" }, { me: null })).toStartWith("# Linked");
  });
});

function status(overrides: Partial<Status> = {}): Status {
  return {
    version: "0.1.0",
    state: "open",
    needsLink: false,
    me: { jid: PEER, lid: "1@lid" },
    lastDisconnect: null,
    history: { progress: 42.4, status: null, updatedAt: 1, phases: [] },
    counts: { chats: 12, messages: 34_567 },
    outbox: { pending: 0 },
    ...overrides,
  };
}

describe("status view", () => {
  test("history sync progress is the sdk summary, capitalised", () => {
    const syncRow = (patch: Partial<HistorySync>) => {
      const history = { progress: null, status: null, updatedAt: null, phases: [], ...patch };
      return statusRows(status({ history }), 7373).find((row) => row.title === "History Sync")
        ?.text;
    };
    expect(syncRow({})).toBe("Not started");
    expect(syncRow({ progress: 42.4, updatedAt: 1 })).toBe("In progress (42%)");
    const bootstrap = { syncType: "initial_bootstrap", progress: null, chunks: 1, updatedAt: 1 };
    expect(syncRow({ phases: [{ ...bootstrap, status: "complete" }] })).toBe("In progress");
    expect(syncRow({ progress: 80, status: "paused", updatedAt: 1 })).toBe("Paused at 80%");
    expect(syncRow({ progress: 80, status: "complete", updatedAt: 1 })).toBe("Complete");
  });

  test("rows cover connection, identity, sync, counts, outbox and engine", () => {
    const rows = Object.fromEntries(
      statusRows(
        status({ outbox: { pending: 2 }, lastDisconnect: { code: 428, at: 1_760_000_000 } }),
        7373,
      ).map((row) => [row.title, row.text]),
    );
    expect(rows).toMatchObject({
      WhatsApp: "Connected",
      "Linked As": "+40700000002",
      "History Sync": "In progress (42%)",
      Chats: "12",
      Messages: "34,567",
      Outbox: "2 waiting",
      Engine: "v0.1.0 on 127.0.0.1:7373",
    });
    expect(rows["Last Disconnect"]).toContain("2025");
    expect(rows["Last Disconnect"]).toContain("(code 428)");
  });

  test("an unlinked engine points at Link WhatsApp", () => {
    const unlinked = status({ state: "not_linked", needsLink: true, me: null });
    expect(statusMarkdown(unlinked)).toContain("Link WhatsApp");
    expect(statusMarkdown(status())).toBe(
      "# Connected\n\nLinked as \\+40700000002. History sync: in progress (42%).",
    );
  });
});
