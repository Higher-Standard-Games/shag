/**
 * CommandRegistry.executeChecked contract — QA-WO11 (step 2) proof.
 *
 * Locks the signal batch/headless runners use to gate the process exit code:
 * structural failures, thrown exceptions, and explicit `fail()` returns are
 * reported as `ok: false`; plain-string results are `ok: true`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { fail } from "../Command";
import { CommandRegistry } from "../CommandRegistry";

const registry = CommandRegistry.getInstance();
const registered: string[] = [];

function tempCommand(name: string, handler: (args: string[]) => unknown): string {
  registry.register(name, handler as never);
  registered.push(name);
  return name;
}

afterEach(() => {
  for (const name of registered.splice(0)) {
    registry.unregister(name);
  }
});

describe("CommandRegistry.executeChecked", () => {
  it("reports ok:true for a plain-string result", async () => {
    const name = tempCommand("qa_ok_cmd", () => "all good");
    await expect(registry.executeChecked(name)).resolves.toEqual({ ok: true, output: "all good" });
  });

  it("reports ok:false when a command returns fail()", async () => {
    const name = tempCommand("qa_fail_cmd", () => fail("could not do the thing"));
    await expect(registry.executeChecked(name)).resolves.toEqual({
      ok: false,
      output: "could not do the thing",
    });
  });

  it("reports ok:false when a command throws", async () => {
    const name = tempCommand("qa_throw_cmd", () => {
      throw new Error("boom");
    });
    const result = await registry.executeChecked(name);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Error executing 'qa_throw_cmd'");
  });

  it("reports ok:false for an unknown command", async () => {
    const result = await registry.executeChecked("definitely_not_a_command_xyz");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Unknown command");
  });

  it("reports ok:true for empty input", async () => {
    await expect(registry.executeChecked("   ")).resolves.toEqual({ ok: true, output: undefined });
  });

  it("execute() still returns just the output string (back-compat)", async () => {
    tempCommand("qa_ok_cmd2", () => "hello");
    await expect(registry.execute("qa_ok_cmd2")).resolves.toBe("hello");
  });
});
