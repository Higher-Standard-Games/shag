// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { validatedBindingOverrides } from "../BindingValidation";
import { InputSystem } from "../InputSystem";

afterEach(() => {
  localStorage.clear();
  InputSystem.getInstance().resetAllBindings();
});
describe("persisted binding shapes", () => {
  it.each([
    null,
    1,
    "text",
    [],
    { move_forward: null },
    { move_forward: {} },
    {
      move_forward: [
        null,
        1,
        {},
        { key: 12 },
        { key: "" },
        { mouseButton: "invalid" },
        { scrollDirection: "left" },
        { gamepadButton: -1 },
      ],
    },
  ])("rejects malformed values without leaving an unsafe override: %j", (data) => {
    expect(validatedBindingOverrides(data).size).toBe(0);
    const input = InputSystem.getInstance();
    localStorage.setItem("shag_keybindings", JSON.stringify(data));
    expect(() => input.loadBindingsFromStorage()).not.toThrow();
    expect(input.getBindingsForAction("move_forward")).toEqual(input.getDefaultBindings("move_forward"));
  });
  it("keeps valid siblings, intentional unbinding, supported modifiers and input sources", () => {
    const data = {
      invalid: {},
      move_forward: [null, { key: "KeyP" }],
      move_back: [],
      combo: [{ key: "KeyX", modifiers: { ctrl: true, shift: false } }],
      sources: [{ mouseButton: "right" }, { scrollDirection: "down" }, { gesture: "tap" }, { gamepadButton: 0 }],
      badModifier: [{ key: "KeyZ", modifiers: { ctrl: "yes" } }],
      badModifierArray: [{ key: "KeyZ", modifiers: [] }],
    };
    const input = InputSystem.getInstance();
    input.importBindings(data);
    expect(input.getBindingsForAction("move_forward")).toEqual([{ key: "KeyP" }]);
    expect(input.getBindingsForAction("move_back")).toEqual([]);
    expect(input.exportBindings().combo).toEqual(data.combo);
    expect(input.exportBindings().sources).toEqual(data.sources);
    expect(input.exportBindings().badModifier).toBeUndefined();
    data.combo[0].modifiers.ctrl = false;
    expect(input.exportBindings().combo[0].modifiers?.ctrl).toBe(true);
    input.resetAllBindings();
    localStorage.setItem("shag_keybindings", JSON.stringify(data));
    input.loadBindingsFromStorage();
    expect(input.getBindingsForAction("move_forward")).toEqual([{ key: "KeyP" }]);
  });
  it("ignores malformed JSON and safely imports an invalid top-level value", () => {
    const input = InputSystem.getInstance();
    localStorage.setItem("shag_keybindings", "{");
    expect(() => input.loadBindingsFromStorage()).not.toThrow();
    input.importBindings(null);
    expect(input.exportBindings()).toEqual({});
  });
});
