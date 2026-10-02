// @vitest-environment jsdom

/**
 * Binding a key to a console command. The `bind` command accepted its
 * arguments and bound nothing until now, so this is the whole contract:
 * what counts as a key, what a press runs, and when a press must be ignored.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandBindings, displayKey, normalizeKey } from "../CommandBindings";

const press = (code: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent =>
  new KeyboardEvent("keydown", { code, ...init });

beforeEach(() => {
  localStorage.clear();
  CommandBindings.resetForTests();
  document.body.innerHTML = "";
});

describe("normalizeKey", () => {
  it("takes what a player types", () => {
    expect(normalizeKey("f")).toBe("KeyF");
    expect(normalizeKey("F")).toBe("KeyF");
    expect(normalizeKey("1")).toBe("Digit1");
    expect(normalizeKey("f5")).toBe("F5");
    expect(normalizeKey("space")).toBe("Space");
    expect(normalizeKey("esc")).toBe("Escape");
    expect(normalizeKey("`")).toBe("Backquote");
    expect(normalizeKey("up")).toBe("ArrowUp");
  });

  it("takes a key code as it comes from the browser", () => {
    expect(normalizeKey("KeyF")).toBe("KeyF");
    expect(normalizeKey("ArrowLeft")).toBe("ArrowLeft");
    expect(normalizeKey("Numpad7")).toBe("Numpad7");
  });

  it("refuses what is not a key", () => {
    expect(normalizeKey("")).toBeNull();
    expect(normalizeKey("   ")).toBeNull();
  });

  it("writes a key back the way it was typed", () => {
    expect(displayKey("KeyF")).toBe("f");
    expect(displayKey("Digit3")).toBe("3");
    expect(displayKey("Backquote")).toBe("`");
    expect(displayKey("ArrowUp")).toBe("ArrowUp");
  });
});

describe("bindings", () => {
  it("binds, reads back and unbinds by any spelling of the key", () => {
    expect(CommandBindings.bind("f", "screenshot")).toBe("KeyF");
    expect(CommandBindings.get("KeyF")).toBe("screenshot");
    expect(CommandBindings.get("F")).toBe("screenshot");
    expect(CommandBindings.unbind("f")).toBe("screenshot");
    expect(CommandBindings.get("f")).toBeUndefined();
  });

  it("refuses a binding with no key or no command", () => {
    expect(CommandBindings.bind("", "screenshot")).toBeNull();
    expect(CommandBindings.bind("f", "   ")).toBeNull();
  });

  it("survives a reload", () => {
    CommandBindings.bind("g", "give all");
    CommandBindings.resetForTests();
    expect(CommandBindings.get("g")).toBe("give all");
  });

  it("clears everything on unbind all", () => {
    CommandBindings.bind("f", "screenshot");
    CommandBindings.bind("g", "give all");
    expect(CommandBindings.unbindAll()).toBe(2);
    expect(CommandBindings.all().size).toBe(0);
  });
});

describe("a bound key", () => {
  it("runs its command on the press", () => {
    const run = vi.fn();
    CommandBindings.attach({ run });
    CommandBindings.bind("f", "screenshot");

    window.dispatchEvent(press("KeyF"));
    expect(run).toHaveBeenCalledWith("screenshot");
  });

  it("does nothing for a key that is not bound", () => {
    const run = vi.fn();
    CommandBindings.attach({ run });
    window.dispatchEvent(press("KeyQ"));
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores a held key repeating", () => {
    const run = vi.fn();
    CommandBindings.attach({ run });
    CommandBindings.bind("f", "screenshot");
    window.dispatchEvent(press("KeyF", { repeat: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves browser and OS combinations alone", () => {
    const run = vi.fn();
    CommandBindings.attach({ run });
    CommandBindings.bind("r", "map reload");
    for (const modifier of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      window.dispatchEvent(press("KeyR", modifier));
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("stays quiet while a text field has the keyboard", () => {
    const run = vi.fn();
    CommandBindings.attach({ run });
    CommandBindings.bind("f", "screenshot");

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    window.dispatchEvent(press("KeyF"));
    expect(run).not.toHaveBeenCalled();
  });

  it("stays quiet while the console is open", () => {
    const run = vi.fn();
    let consoleOpen = true;
    CommandBindings.attach({ run, isBlocked: () => consoleOpen });
    CommandBindings.bind("f", "screenshot");

    window.dispatchEvent(press("KeyF"));
    expect(run).not.toHaveBeenCalled();

    consoleOpen = false;
    window.dispatchEvent(press("KeyF"));
    expect(run).toHaveBeenCalledWith("screenshot");
  });

  it("stops firing once detached", () => {
    const run = vi.fn();
    CommandBindings.attach({ run });
    CommandBindings.bind("f", "screenshot");
    CommandBindings.detach();

    window.dispatchEvent(press("KeyF"));
    expect(run).not.toHaveBeenCalled();
  });
});
