// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

async function setup(production: boolean, ssr: boolean) {
  vi.stubEnv("PROD", production);
  vi.stubEnv("SSR", ssr);
  const { Cvar } = await import("../../core/Cvar");
  const { CommandRegistry } = await import("../CommandRegistry");
  const { default: DeveloperCommand } = await import("../commands/DeveloperCommand");
  const { default: EditorCommand } = await import("../commands/EditorCommand");
  const { default: SetCommand } = await import("../commands/SetCommand");
  const { default: ToggleCommand } = await import("../commands/ToggleCommand");
  const { registerEditorLauncher } = await import("../../editor/EditorLauncher");
  const open = vi.fn(async () => ({ open: true }));
  registerEditorLauncher({ open, close: async () => ({ open: false }), status: () => ({ open: false }) });
  const registry = CommandRegistry.getInstance();
  registry.register(new DeveloperCommand());
  registry.register(new EditorCommand());
  registry.register(new SetCommand());
  registry.register(new ToggleCommand());
  return { Cvar, registry, open };
}

describe("production developer mode", () => {
  it("ignores stored developer mode before and after registration", async () => {
    const { Cvar } = await setup(true, false);
    localStorage.setItem("engine_cvars", '{"developer":1,"cl_fov":110}');
    Cvar.init();
    expect(Cvar.getBool("developer")).toBe(false);
    const cvar = Cvar.register("developer", 1);
    expect(cvar.value).toBe(0);
    expect(cvar.flags).toMatchObject({ readonly: true, persist: false });
    expect(Cvar.getNumber("cl_fov")).toBe(110);
    expect(Cvar.register("DEVELOPER", true).value).toBe(0);
  });

  it("rejects commands, aliases, setters, toggles and config imports, keeping the editor closed", async () => {
    const { Cvar, registry, open } = await setup(true, false);
    Cvar.register("developer", 0);
    for (const command of ["developer 1", "dev on"]) {
      const result = await registry.executeChecked(command);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("disabled in production builds");
    }
    for (const command of ["set developer 1", "toggle developer"]) await registry.executeChecked(command);
    expect(Cvar.set("DEVELOPER", 1)).toBe(false);
    expect(Cvar.execConfig("developer 1").rejected).toHaveLength(1);
    expect(Cvar.getBool("developer")).toBe(false);
    expect((await registry.executeChecked("editor open")).ok).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect((await registry.executeChecked("developer")).output).toBe("Developer mode is disabled");
  });

  it.each([
    [false, false],
    [true, true],
  ])("retains developer tools for PROD=%s SSR=%s", async (prod, ssr) => {
    const { Cvar, registry, open } = await setup(prod, ssr);
    Cvar.register("developer", 0);
    expect((await registry.executeChecked("editor open")).ok).toBe(false);
    expect((await registry.executeChecked("developer 1")).ok).toBe(true);
    expect(Cvar.getBool("developer")).toBe(true);
    expect((await registry.executeChecked("editor open")).ok).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });
});
