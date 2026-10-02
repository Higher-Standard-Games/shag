// @vitest-environment jsdom

/**
 * The console's action-button row and the hover-help popover on command
 * names: both are DOM behavior the string-returning command tests elsewhere
 * can't reach.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DebugConsole } from "../DebugConsole";

function buttons(console_: HTMLElement) {
  return {
    inspect: console_.querySelector<HTMLButtonElement>(".console-inspect-btn")!,
    help: console_.querySelector<HTMLButtonElement>(".console-help-btn")!,
    size: console_.querySelector<HTMLButtonElement>(".console-size-btn")!,
    clear: console_.querySelector<HTMLButtonElement>(".console-clear-btn")!,
  };
}

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
