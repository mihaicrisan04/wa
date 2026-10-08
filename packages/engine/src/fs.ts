import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "./logger";

/** Written whole or not at all, readable only by the owner; creates the directory 0700. */
export async function writeFileAtomic(
  path: string,
  data: Parameters<typeof writeFile>[1],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const partial = `${path}.${randomUUID()}.part`;
  try {
    await writeFile(partial, data, { mode: 0o600 });
    await chmod(partial, 0o600);
    await rename(partial, path);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
}

/** Best effort: a file that can't be removed is logged, never thrown. */
export async function removeFiles(paths: string[], logger: Logger): Promise<void> {
  await Promise.all(
    paths.map((path) =>
      rm(path, { force: true }).catch((err: unknown) => {
        logger.warn({ err, path }, "could not remove a file");
      }),
    ),
  );
}
