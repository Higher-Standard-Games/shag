// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => localStorage.clear());

it.each([
  "null",
  "[]",
  "42",
  '"bad"',
  '{"cl_showspeed":"bad","cl_flyspeed":900}',
])("survives malformed legacy preferences: %s", async (stored) => {
  vi.resetModules();
  localStorage.setItem("engine.movementVars", stored);
  const { MovementVars } = await import("../MovementVars");
  const movement = MovementVars.getInstance();
  expect(movement.get("cl_showspeed")).toBe(1);
  if (stored.includes("900")) expect(movement.get("cl_flyspeed")).toBe(900);
});

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

it("keeps saved speed hidden until reset, then uses the declared enabled default", async () => {
  vi.resetModules();
  localStorage.setItem("engine.movementVars", JSON.stringify({ cl_showspeed: 0 }));
  const { Cvar } = await import("../../core/Cvar");
  const { MovementVars } = await import("../MovementVars");
  Cvar.init();
  const movement = MovementVars.getInstance();
  expect(movement.get("cl_showspeed")).toBe(0);
  Cvar.reset("cl_showspeed");
  expect(movement.get("cl_showspeed")).toBe(1);
  expect(Cvar.getNumber("cl_showspeed")).toBe(1);
});

it("agrees with a saved cvar when no legacy movement preference exists", async () => {
  vi.resetModules();
  localStorage.setItem("engine_cvars", JSON.stringify({ cl_showspeed: 0 }));
  const { Cvar } = await import("../../core/Cvar");
  const { MovementVars } = await import("../MovementVars");
  Cvar.init();
  expect(MovementVars.getInstance().get("cl_showspeed")).toBe(0);
  expect(Cvar.getNumber("cl_showspeed")).toBe(0);
});
