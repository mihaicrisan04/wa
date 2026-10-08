/** Polls until `check` holds; fails the test after a second, naming `what` it waited for. */
export async function eventually(check: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 1_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}
