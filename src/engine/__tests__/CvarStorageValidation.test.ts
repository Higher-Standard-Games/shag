// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Cvar } from "../core/Cvar";

const reset = () => {
  Reflect.set(Cvar, "cvars", new Map());
  Reflect.set(Cvar, "initialized", false);
  Reflect.set(Cvar, "consoleIntegration", null);
};
beforeEach(() => {
  reset();
  localStorage.clear();
});
afterEach(reset);
describe("cvar storage validation", () => {
  it("drops invalid entries individually and preserves valid siblings and numeric bounds", () => {
    localStorage.setItem(
      "engine_cvars",
      '{"s_musicenabled":null,"badObject":{},"badArray":[],"cl_fov":9999,"good":false,"numericText":"bad","overflow":1e999}',
    );
    Cvar.init();
    expect(() => Cvar.register("s_musicenabled", true, { type: "bool" })).not.toThrow();
    Cvar.register("cl_fov", 110, { type: "float", min: 60, max: 150 });
    Cvar.register("numericText", 12, { type: "float" });
    expect(Cvar.getBool("s_musicenabled")).toBe(true);
    expect(Cvar.getNumber("cl_fov")).toBe(150);
    expect(Cvar.getNumber("numericText")).toBe(12);
    expect(Cvar.get("good")).toBe(false);
    expect(Cvar.get("badObject")).toBeUndefined();
    expect(Cvar.get("overflow")).toBeUndefined();
  });
  it.each(["null", "[]", "42", '"text"', "{"])("safely loads invalid top-level JSON: %s", (json) => {
    localStorage.setItem("engine_cvars", json);
    expect(() => Cvar.init()).not.toThrow();
    expect(() => Cvar.register("s_musicenabled", true)).not.toThrow();
    expect(Cvar.getBool("s_musicenabled")).toBe(true);
  });
  it("refuses non-finite runtime numbers without changing or persisting a valid value", () => {
    Cvar.register("quality_number", 12);
    for (const value of [NaN, Infinity, -Infinity]) expect(Cvar.set("quality_number", value)).toBe(false);
    expect(Cvar.getNumber("quality_number")).toBe(12);
    expect(localStorage.getItem("engine_cvars")).toBeNull();
  });
});
