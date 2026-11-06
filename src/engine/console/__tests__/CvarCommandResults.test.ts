import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

async function setup() {
  const { Cvar } = await import("../../core/Cvar");
  const { CommandRegistry } = await import("../CommandRegistry");
  const { default: SetCommand } = await import("../commands/SetCommand");
  const { default: ToggleCommand } = await import("../commands/ToggleCommand");
  const { default: ResetCommand } = await import("../commands/ResetCommand");
  const registry = CommandRegistry.getInstance();
  registry.register(new SetCommand());
  registry.register(new ToggleCommand());
  registry.register(new ResetCommand());
  Cvar.register("player_test", 1, { type: "int", persist: false });
  return { Cvar, registry };
}

it.each([
  ["set", "Usage: set <cvar> <value>"],
  ["set player_test", "Usage: set <cvar> <value>"],
  ["toggle", "Usage: toggle <cvar>"],
  ["reset", "Usage: reset <cvar>"],
  ["set missing_test 1", "Unknown cvar: missing_test"],
  ["toggle missing_test", "Unknown cvar: missing_test"],
  ["reset missing_test", "Unknown cvar: missing_test"],
])("reports %s as a checked failure without changing player settings", async (command, output) => {
  const { Cvar, registry } = await setup();
  expect(await registry.executeChecked(command)).toEqual({ ok: false, output });
  expect(Cvar.getNumber("player_test")).toBe(1);
  expect(Cvar.exists("missing_test")).toBe(false);
});

it("preserves valid set, toggle and reset operations", async () => {
  const { Cvar, registry } = await setup();
  expect(await registry.executeChecked("set player_test 2")).toEqual({ ok: true, output: "player_test = 2" });
  expect(Cvar.getNumber("player_test")).toBe(2);
  expect(await registry.executeChecked("toggle player_test")).toEqual({ ok: true, output: "player_test = 0" });
  expect(Cvar.getNumber("player_test")).toBe(0);
  expect(await registry.executeChecked("reset player_test")).toEqual({
    ok: true,
    output: "player_test reset to 1",
  });
  expect(Cvar.getNumber("player_test")).toBe(1);
});
