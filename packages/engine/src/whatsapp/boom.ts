/** The HTTP-like status Baileys puts on its Boom errors (`output.statusCode`). */
export function boomStatus(err: unknown): number | null {
  const status = (err as { output?: { statusCode?: unknown } } | null)?.output?.statusCode;
  return typeof status === "number" ? status : null;
}
