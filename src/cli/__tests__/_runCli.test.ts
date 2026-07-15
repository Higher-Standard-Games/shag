/**
 * runCli contract — QA-WO11 proof.
 *
 * Locks the behavior that a CLI entry point which fails must be observable at
 * the process level (non-zero exit code), instead of the old
 * `main().catch(console.error)` tail that logged and exited 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../_runCli";

describe("runCli", () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    // Never leak a failure code into the vitest process itself.
    process.exitCode = originalExitCode ?? 0;
    vi.restoreAllMocks();
  });

  it("sets exit code 1 when the entry function rejects", async () => {
    process.exitCode = 0;
    await runCli(async () => {
      throw new Error("boom");
    });
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("sets exit code 1 when the entry function throws synchronously", async () => {
    process.exitCode = 0;
    await runCli(() => {
      throw new Error("sync boom");
    });
    expect(process.exitCode).toBe(1);
  });

  it("leaves the exit code at 0 on success", async () => {
    process.exitCode = 0;
    await runCli(async () => {
      /* completes normally */
    });
    expect(process.exitCode).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
  });
});
