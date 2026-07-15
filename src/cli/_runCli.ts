/**
 * runCli — shared entry-point wrapper for `src/cli/*` scripts.
 *
 * Replaces the `main().catch(console.error)` tail. That pattern logs an
 * unexpected rejection but lets the process exit 0, so a top-level failure is
 * invisible to CI and agents (QA-23 / QA-WO11: "an unexpected rejection can log
 * and still exit 0"). This wrapper awaits the entry function and, on any
 * unhandled rejection, prints the error and sets a non-zero exit code so the
 * failure is observable at the process level.
 *
 * Uses `process.exitCode = 1` rather than `process.exit(1)` so pending stdout
 * flushes and any already-opened handles (servers, REPLs) still close cleanly;
 * a startup throw has no such handles and exits promptly.
 *
 * Returns the settled promise so it can be awaited in tests; the CLI tail usage
 * `runCli(main)` intentionally ignores the return value.
 */
export function runCli(main: () => unknown | Promise<unknown>): Promise<void> {
  return Promise.resolve()
    .then(main)
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
