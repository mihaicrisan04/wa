export interface Backoff {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: Backoff = { baseMs: 1_000, maxMs: 60_000 };

/** Doubles from `baseMs` on every attempt (1-based), capped at `maxMs`. */
export function backoffDelay({ baseMs, maxMs }: Backoff, attempt: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), maxMs);
}
