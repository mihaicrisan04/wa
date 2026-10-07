import type { Qr } from "./types";

/** Where a client's link flow stands, from the engine's pairing state. */
export type LinkStep =
  | { kind: "linked" }
  /** Linked, the engine is (re)connecting; also the moment right after a scan. */
  | { kind: "connecting" }
  /** Not linked and the client hasn't asked the engine to pair yet. */
  | { kind: "start" }
  | { kind: "qr"; qr: string }
  | { kind: "waiting" }
  /** Pairing was started and ended unscanned (WhatsApp stops after a few QR codes). */
  | { kind: "stopped" }
  | { kind: "replaced" }
  | { kind: "engine_stopped" };

export function linkStep({ state, qr }: Qr, pairingStarted: boolean): LinkStep {
  switch (state) {
    case "open":
      return { kind: "linked" };
    case "connecting":
    case "reconnecting":
      return { kind: "connecting" };
    case "linking":
      return qr ? { kind: "qr", qr } : { kind: "waiting" };
    case "not_linked":
    case "needs_link":
      return pairingStarted ? { kind: "stopped" } : { kind: "start" };
    case "replaced":
      return { kind: "replaced" };
    case "stopped":
      return { kind: "engine_stopped" };
  }
}

/** Steps that polling the pairing state can't move past. */
export function isFinal(step: LinkStep): boolean {
  return step.kind === "linked" || step.kind === "stopped" || step.kind === "replaced";
}
