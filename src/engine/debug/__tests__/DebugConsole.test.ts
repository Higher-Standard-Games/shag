// @vitest-environment jsdom

/**
 * The console's action-button row and the hover-help popover on command
 * names: both are DOM behavior the string-returning command tests elsewhere
 * can't reach.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "../../console/CommandRegistry";
import HelpCommand from "../../console/commands/HelpCommand";
import { DebugConsole } from "../DebugConsole";

function buttons(console_: HTMLElement) {
  return {
    inspect: console_.querySelector<HTMLButtonElement>(".console-inspect-btn")!,
    help: console_.querySelector<HTMLButtonElement>(".console-help-btn")!,
    size: console_.querySelector<HTMLButtonElement>(".console-size-btn")!,
    clear: console_.querySelector<HTMLButtonElement>(".console-clear-btn")!,
  };
}

// "help" is registered by the commands/ auto-discovery loader
// (registerEngineCommands()) in the running app, not by DebugConsole itself —
// register it the same way here, since the hover-help tests below exercise it.
beforeEach(() => {
  CommandRegistry.getInstance().register(new HelpCommand());
});

afterEach(() => {
  DebugConsole.getInstance().disable();
});

describe("DebugConsole action buttons", () => {
  it("renders one button per action, inside a single row", () => {
    DebugConsole.getInstance().enable();
    const el = document.querySelector<HTMLElement>(".debug-console")!;
    const row = el.querySelector(".debug-console-actions")!;
    const { inspect, help, size, clear } = buttons(el);

    expect(row.contains(inspect)).toBe(true);
    expect(row.contains(help)).toBe(true);
    expect(row.contains(size)).toBe(true);
    expect(row.contains(clear)).toBe(true);

    // Same widget the main menu's own buttons use (RaisedKey), not a
    // console-only <button> — the "ink" face for the console's dark bg.
    for (const button of [inspect, help, size, clear]) {
      expect(button.classList.contains("raised-key")).toBe(true);
      expect(button.classList.contains("raised-key--ink")).toBe(true);
    }
  });

  it("cycles con_size 50% → 75% → 100% → 50% on repeated clicks", () => {
    DebugConsole.getInstance().enable();
    const el = document.querySelector<HTMLElement>(".debug-console")!;
    const { size } = buttons(el);

    expect(DebugConsole.getInstance().getSize()).toBeCloseTo(0.5);
    size.click();
    expect(DebugConsole.getInstance().getSize()).toBeCloseTo(0.75);
    size.click();
    expect(DebugConsole.getInstance().getSize()).toBeCloseTo(1.0);
    size.click();
    expect(DebugConsole.getInstance().getSize()).toBeCloseTo(0.5);
  });

  it("runs clear on click, emptying the output", () => {
    const dc = DebugConsole.getInstance();
    dc.enable();
    dc.log("system", "something logged before clearing");
    const el = document.querySelector<HTMLElement>(".debug-console")!;
    const output = el.querySelector(".debug-console-output")!;
    expect(output.children.length).toBeGreaterThan(0);

    buttons(el).clear.click();

    expect(output.children.length).toBe(0);
  });
});

describe("DebugConsole hover help", () => {
  it("tags help's command names as hoverable terms with their help text ready", async () => {
    const dc = DebugConsole.getInstance();
    dc.enable();
    const el = document.querySelector<HTMLElement>(".debug-console")!;
    const output = el.querySelector(".debug-console-output")!;

    buttons(el).help.click();
    await vi.waitFor(() => {
      expect(output.querySelector('.console-help-term[data-help-cmd="clear"]')).not.toBeNull();
    });

    const term = output.querySelector<HTMLElement>('.console-help-term[data-help-cmd="clear"]')!;
    expect(term.classList.contains("clickable-cmd")).toBe(true);
  });

  it("shows a popover with the command's help text on hover, hides it on mouseout", async () => {
    const dc = DebugConsole.getInstance();
    dc.enable();
    const el = document.querySelector<HTMLElement>(".debug-console")!;
    const output = el.querySelector(".debug-console-output")!;

    buttons(el).help.click();
    await vi.waitFor(() => {
      expect(output.querySelector('.console-help-term[data-help-cmd="clear"]')).not.toBeNull();
    });

    const term = output.querySelector<HTMLElement>('.console-help-term[data-help-cmd="clear"]')!;
    term.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const popover = document.querySelector<HTMLElement>(".console-help-popover")!;
    expect(popover.classList.contains("visible")).toBe(true);
    expect(popover.textContent).toContain("clear");

    term.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: output }));
    expect(popover.classList.contains("visible")).toBe(false);
  });

  it("removes the popover element from the DOM on disable", () => {
    const dc = DebugConsole.getInstance();
    dc.enable();
    expect(document.querySelector(".console-help-popover")).not.toBeNull();

    dc.disable();
    expect(document.querySelector(".console-help-popover")).toBeNull();
  });
});

describe("DebugConsole input focus", () => {
  it("puts the cursor in the input line when opened", () => {
    const consoleUi = DebugConsole.getInstance();
    consoleUi.enable();
    consoleUi.open();
    expect(document.activeElement?.classList.contains("debug-console-input")).toBe(true);
    consoleUi.close();
  });

  it("takes focus back from a menu that opens when pointer lock is released", async () => {
    const canvas = document.createElement("canvas");
    const menu = document.createElement("div");
    menu.tabIndex = -1;
    document.body.append(canvas, menu);
    let locked: Element | null = canvas;
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => locked });
    document.exitPointerLock = () => {
      locked = null;
      // The game's own listener, registered first, opens its pause menu.
      queueMicrotask(() => {
        menu.focus();
        document.dispatchEvent(new Event("pointerlockchange"));
      });
    };
    document.addEventListener("pointerlockchange", () => menu.focus(), { once: true });

    const consoleUi = DebugConsole.getInstance();
    consoleUi.enable();
    consoleUi.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement?.classList.contains("debug-console-input")).toBe(true);
    menu.remove();
    canvas.remove();
    Reflect.deleteProperty(document, "pointerLockElement");
  });
});
