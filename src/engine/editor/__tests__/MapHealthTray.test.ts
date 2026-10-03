// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapHealthIssue } from "../MapHealth";
import { MapHealthTray } from "../MapHealthTray";

const ISSUES: MapHealthIssue[] = [
  { code: "no-spawn", severity: "warning", message: "Map has no player spawn point.", objectId: null },
  {
    code: "required-key",
    severity: "warning",
    message: 'trigger_teleport needs "target".',
    objectId: "trigger-1",
  },
  {
    code: "unknown-shader",
    severity: "warning",
    message: 'Shader "foo/bar" is absent from the mounted catalog.',
    objectId: "box-1",
    face: "+Z",
  },
  {
    code: "duplicate-targetname",
    severity: "info",
    message: 'Target name "pad" is shared by 2 entities.',
    objectId: "box-2",
  },
];

function setup(issues: MapHealthIssue[] = ISSUES) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const inspect = vi.fn(() => issues);
  const tray = new MapHealthTray({ issues: inspect, onSelect, onClose });
  document.body.appendChild(tray.element);
  const rows = () => [...tray.element.querySelectorAll<HTMLElement>(".shagged-health__row")];
  return { tray, onSelect, onClose, inspect, rows };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("map health tray", () => {
  it("starts hidden and shows nothing until opened", () => {
    const { tray, inspect } = setup();
    expect(tray.isOpen).toBe(false);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("opens by recomputing issues, warnings before info, with a count summary", () => {
    const { tray, inspect, rows } = setup();
    tray.open();
    expect(tray.isOpen).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(4);
    expect(rows().map((row) => row.className.includes("warning"))).toEqual([true, true, true, false]);
    expect(tray.element.querySelector("[data-count]")!.textContent).toBe("3 warnings, 1 info");
  });

  it("shows an all-clear state with no issues", () => {
    const { tray } = setup([]);
    tray.open();
    expect(tray.element.querySelector("[data-count]")!.textContent).toBe("All clear");
    expect(tray.element.querySelector(".shagged-health__empty")).not.toBeNull();
  });

  it("selects the object (and face) a clickable row points to, but not a row with no object", () => {
    const { tray, onSelect, rows } = setup();
    tray.open();
    const [noSpawnRow, keyRow, shaderRow] = rows();
    expect(noSpawnRow.tagName).toBe("DIV"); // nothing to select
    noSpawnRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();

    keyRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("trigger-1", undefined);

    shaderRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("box-1", "+Z");
  });

  it("re-checks on demand without needing to reopen, and closes on the button or Escape", () => {
    const { tray, inspect, onClose, rows } = setup();
    tray.open();
    inspect.mockReturnValue([]);
    tray.element.querySelector<HTMLButtonElement>(".shagged-health__refresh")!.click();
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(0);

    tray.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tray.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggle opens and closes, and keeps its keys from reaching the editor's shortcuts", () => {
    const { tray } = setup();
    const outside = vi.fn();
    document.body.addEventListener("keydown", outside);
    tray.toggle();
    expect(tray.isOpen).toBe(true);
    tray.element.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    expect(outside).not.toHaveBeenCalled();
    tray.toggle();
    expect(tray.isOpen).toBe(false);
    document.body.removeEventListener("keydown", outside);
  });

  it("disposes by removing its element", () => {
    const { tray } = setup();
    tray.dispose();
    expect(document.body.contains(tray.element)).toBe(false);
  });
});
