// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(production = false) {
  vi.stubEnv("PROD", production);
  vi.stubEnv("SSR", false);
  const { Cvar } = await import("../../core/Cvar");
  const { CommandRegistry } = await import("../CommandRegistry");
  const { default: SetCommand } = await import("../commands/SetCommand");
  const { default: ToggleCommand } = await import("../commands/ToggleCommand");
  const { default: ResetCommand } = await import("../commands/ResetCommand");
  const registry = CommandRegistry.getInstance();
  registry.register(new SetCommand());
  registry.register(new ToggleCommand());
  registry.register(new ResetCommand());
  Cvar.register("developer", 0);
  const changed = vi.fn();
  Cvar.register("raw_test", 0, { developer: true, onChange: changed });
  Cvar.register("player_test", 1);
  return { Cvar, registry, changed };
}

describe("developer cvar access", () => {
  it("preserves the god command's toggle behavior with developer access", async () => {
    const { Cvar } = await setup();
    const { default: GodCommand } = await import("../commands/GodCommand");
    const command = new GodCommand();
    Cvar.set("developer", 1);
    await expect(command.execute()).resolves.toBe("God mode: ON");
    await expect(command.execute()).resolves.toBe("God mode: OFF");
    Cvar.set("developer", 0);
    expect(await command.execute()).toEqual({ ok: false, output: "God mode requires developer mode." });
    expect(Cvar.getBool("g_godmode")).toBe(false);
  });

  it("declares the god-mode cvar before its first command use in production", async () => {
    const { Cvar } = await setup(true);
    localStorage.setItem("engine_cvars", '{"g_godmode":true}');
    Cvar.init();
    await import("../commands/GodCommand");
    expect(Cvar.getCvar("g_godmode")?.flags.developer).toBe(true);
    expect(Cvar.getBool("g_godmode")).toBe(false);
    expect(Cvar.set("g_godmode", true)).toBe(false);
  });

  it("blocks direct, alias and config mutations without callbacks", async () => {
    const { Cvar, registry, changed } = await setup();
    for (const command of ["raw_test 1", "set raw_test 1", "toggle raw_test", "reset raw_test", "raw_test"]) {
      expect((await registry.executeChecked(command)).ok, command).toBe(false);
    }
    expect(Cvar.set("raw_test", 1)).toBe(false);
    expect(Cvar.execConfig("raw_test 1\nplayer_test 2")).toEqual({
      accepted: 1,
      rejected: [{ line: 1, reason: "Requires developer mode" }],
    });
    expect(Cvar.getNumber("raw_test")).toBe(0);
    expect(Cvar.getNumber("player_test")).toBe(2);
    expect(changed).not.toHaveBeenCalled();
    expect(Cvar.getNames()).not.toContain("raw_test");
    expect(Cvar.list().map((v) => v.name)).not.toContain("raw_test");
  });

  it("permits developer edits and resets protected values before disabling developer", async () => {
    const { Cvar, registry, changed } = await setup();
    Cvar.set("developer", 1);
    expect((await registry.executeChecked("set raw_test 1")).ok).toBe(true);
    expect(Cvar.getNames()).toContain("raw_test");
    expect(Cvar.exportConfig()).toContain("raw_test");
    Cvar.resetAll();
    expect(Cvar.getNumber("raw_test")).toBe(0);
    expect(Cvar.getBool("developer")).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("keeps player edits and resets available at developer 0", async () => {
    const { Cvar, registry } = await setup();
    expect((await registry.executeChecked("set player_test 2")).ok).toBe(true);
    expect((await registry.executeChecked("reset player_test")).ok).toBe(true);
    expect(Cvar.getNumber("player_test")).toBe(1);
  });

  it.each([true, false])("ignores production protected preferences registered first=%s", async (first) => {
    const { Cvar } = await setup(true);
    if (first) Cvar.register("protected_saved", 3, { developer: true });
    localStorage.setItem("engine_cvars", '{"PROTECTED_SAVED":9,"raw_test":1,"developer":1,"player_test":2}');
    Cvar.init();
    if (!first) Cvar.register("protected_saved", 3, { developer: true });
    expect(Cvar.getNumber("protected_saved")).toBe(3);
    expect(Cvar.getNumber("raw_test")).toBe(0);
    expect(Cvar.getNumber("player_test")).toBe(2);
    expect(Cvar.set("developer", 1)).toBe(false);
    expect(Cvar.execConfig("raw_test 1").rejected).toHaveLength(1);
  });

  it("ignores protected owner caches in production while retaining player render preferences", async () => {
    const { Cvar } = await setup(true);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    localStorage.setItem("engine.renderVars", '{"r_ambient":3,"r_exposure":1.4}');
    localStorage.setItem("engine.movementVars", '{"sv_gravity":1,"cl_wep_scale":4,"cl_fov":100}');
    const { RenderVars } = await import("../../rendering/RenderVars");
    const { MovementVars } = await import("../../movement/MovementVars");
    const render = RenderVars.getInstance();
    const movement = MovementVars.getInstance();
    expect(render.get("r_ambient")).toBe(render.getVar("r_ambient")?.defaultValue);
    expect(render.get("r_exposure")).toBe(1.4);
    expect(movement.get("sv_gravity")).toBe(movement.getVar("sv_gravity")?.defaultValue);
    expect(movement.get("cl_wep_scale")).toBe(0);
    expect(movement.get("cl_fov")).toBe(100);
    expect(Cvar.set("r_wireframe", 1)).toBe(false);
    expect(Cvar.set("r_exposure", 1.2)).toBe(true);
    expect(movement.set("sv_gravity", 1)).toBe(false);
    expect(movement.get("sv_gravity")).toBe(movement.getVar("sv_gravity")?.defaultValue);
  });
});
