// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UINavigation } from "../navigation/UINavigation";

let nav: UINavigation;
function key(root: HTMLElement, name: string, x: number, y: number): HTMLButtonElement {
  const node = document.createElement("button");
  node.textContent = name;
  node.dataset.navId = name;
  node.getBoundingClientRect = () => ({
    x,
    y,
    left: x,
    top: y,
    right: x + 80,
    bottom: y + 30,
    width: 80,
    height: 30,
    toJSON() {},
  });
  root.append(node);
  return node;
}
beforeEach(() => {
  nav = new UINavigation();
  nav.setEnabled(true);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [document.body.getBoundingClientRect()] as unknown as DOMRectList,
  );
});
afterEach(() => {
  nav.setEnabled(false);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("controller navigation of existing DOM", () => {
  it("walks vertical menu items in order regardless of their animated geometry", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const resume = key(root, "Resume", 100, 100);
    const hidden = key(root, "Hidden", 100, 110);
    hidden.hidden = true;
    const settings = key(root, "Settings", 300, 90);
    const disabled = key(root, "Disabled", 100, 130);
    disabled.disabled = true;
    const leave = key(root, "Leave", 0, 500);
    nav.push({ root, navigation: "vertical" });
    nav.refresh();
    nav.handle("down");
    expect(document.activeElement).toBe(settings);
    nav.handle("down");
    nav.handle("down");
    expect(document.activeElement).toBe(leave);
    nav.handle("up");
    nav.handle("up");
    expect(document.activeElement).toBe(resume);
  });
  it("uses the screen entry point before DOM order and resets it only for the active owner", () => {
    const root = document.createElement("div");
    const modal = document.createElement("div");
    document.body.append(root, modal);
    const stage = key(root, "Stage", 400, 0);
    const rail = key(root, "Rail", 0, 0);
    const map = key(root, "Vote map", 400, 100);
    const modalKey = key(modal, "Modal", 0, 0);
    let entry = rail;
    nav.push({ root, initialFocus: () => entry });
    nav.refresh();
    expect(document.activeElement).toBe(rail);
    entry = map;
    nav.focusDefault(root);
    expect(document.activeElement).toBe(map);
    const off = nav.push({ root: modal });
    nav.refresh();
    nav.focusDefault(root);
    expect(document.activeElement).toBe(modalKey);
    off();
    modal.remove();
    entry.disabled = true;
    rail.disabled = true;
    nav.focusDefault(root);
    expect(document.activeElement).toBe(stage);
  });
  it("follows native focus after a mouse or keyboard selection", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const first = key(root, "First", 0, 0);
    const second = key(root, "Second", 0, 100);
    const activate = vi.fn();
    second.onclick = activate;
    nav.push({ root });
    nav.refresh();
    second.focus();
    nav.handle("confirm");
    expect(activate).toHaveBeenCalledOnce();
    expect(first.classList.contains("controller-focus")).toBe(false);
    expect(second.classList.contains("controller-focus")).toBe(true);
  });
  it("ignores scopes inside hidden or inert ancestors", () => {
    const parent = document.createElement("div");
    const root = document.createElement("div");
    parent.append(root);
    document.body.append(parent);
    key(root, "Hidden scope", 0, 0);
    nav.push({ root });
    expect(nav.active).toBe(true);
    parent.hidden = true;
    expect(nav.active).toBe(false);
    parent.hidden = false;
    parent.inert = true;
    expect(nav.active).toBe(false);
    parent.inert = false;
    parent.setAttribute("aria-hidden", "true");
    expect(nav.active).toBe(false);
  });
  it("does not steal modal focus when an underlying scope is removed", () => {
    const parent = document.createElement("div");
    const child = document.createElement("div");
    document.body.append(parent, child);
    key(parent, "Parent", 0, 0);
    const modalKey = key(child, "Modal", 0, 0);
    const offParent = nav.push({ root: parent });
    nav.refresh();
    nav.push({ root: child });
    nav.refresh();
    offParent();
    expect(document.activeElement).toBe(modalKey);
    nav.refresh();
    expect(modalKey.classList.contains("controller-focus")).toBe(true);
  });
  it("restores the opener after modal cleanup removes background inertness", () => {
    const parent = document.createElement("div");
    const child = document.createElement("div");
    document.body.append(parent, child);
    key(parent, "First", 0, 0);
    const opener = key(parent, "Opener", 0, 100);
    key(child, "Modal", 0, 0);
    nav.push({ root: parent });
    nav.refresh();
    opener.focus();
    nav.refresh();
    const off = nav.push({ root: child });
    parent.inert = true;
    nav.refresh();
    child.remove();
    off();
    parent.inert = false;
    nav.refresh();
    expect(document.activeElement).toBe(opener);
  });
  it("does not rescan every control on each idle controller frame", () => {
    const root = document.createElement("div");
    document.body.append(root);
    for (let i = 0; i < 100; i++) key(root, String(i), 0, i * 100);
    nav.push({ root });
    nav.refresh();
    const scan = vi.spyOn(root, "querySelectorAll");
    nav.refresh();
    nav.refresh();
    expect(scan).not.toHaveBeenCalled();
  });
  it("discards a disabled modal opener instead of restoring it after later navigation", () => {
    const parent = document.createElement("div");
    const child = document.createElement("div");
    document.body.append(parent, child);
    const first = key(parent, "First", 0, 0);
    const opener = key(parent, "Opener", 0, 100);
    key(child, "Modal", 0, 0);
    nav.push({ root: parent });
    nav.refresh();
    opener.focus();
    nav.refresh();
    const off = nav.push({ root: child });
    nav.refresh();
    opener.disabled = true;
    off();
    child.remove();
    nav.refresh();
    expect(document.activeElement).toBe(first);
    opener.disabled = false;
    nav.refresh();
    expect(document.activeElement).toBe(first);
  });
  it("moves between rail and stage controls, skipping hidden and disabled controls", () => {
    const root = document.createElement("main");
    document.body.append(root);
    const first = key(root, "Rail", 0, 0);
    const hidden = key(root, "Hidden", 100, 0);
    hidden.hidden = true;
    const disabled = key(root, "Disabled", 200, 0);
    disabled.disabled = true;
    const target = key(root, "Stage", 300, 0);
    const activate = vi.fn();
    target.onclick = activate;
    nav.push({ root });
    nav.refresh();
    expect(document.activeElement).toBe(first);
    nav.handle("right");
    nav.handle("confirm");
    expect(document.activeElement).toBe(target);
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it("adjusts a range through its existing input/change handlers", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "10";
    slider.step = "2";
    slider.value = "4";
    root.append(slider);
    const input = vi.fn(),
      change = vi.fn();
    slider.oninput = input;
    slider.onchange = change;
    nav.push({ root });
    nav.refresh();
    nav.handle("right");
    expect(slider.value).toBe("6");
    expect(input).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
  });
  it("backs out of only the top scope and restores the opener", () => {
    const parent = document.createElement("div"),
      child = document.createElement("div");
    document.body.append(parent, child);
    const opener = key(parent, "Open", 0, 0);
    key(child, "Child", 0, 0);
    const back = vi.fn();
    nav.push({ root: parent, back });
    nav.refresh();
    const off = nav.push({
      root: child,
      back: () => {
        off();
        child.remove();
      },
    });
    nav.refresh();
    nav.handle("back");
    expect(back).not.toHaveBeenCalled();
    nav.refresh();
    expect(document.activeElement).toBe(opener);
    nav.handle("back");
    expect(back).toHaveBeenCalledOnce();
  });
  it("restores a stable action after the screen redraws", () => {
    const root = document.createElement("div");
    document.body.append(root);
    key(root, "One", 0, 0);
    key(root, "Two", 0, 100);
    nav.push({ root });
    nav.refresh();
    nav.handle("down");
    root.replaceChildren();
    key(root, "One", 0, 0);
    const replacement = key(root, "Two", 0, 100);
    nav.refresh();
    expect(document.activeElement).toBe(replacement);
    expect(replacement.classList.contains("controller-focus")).toBe(true);
  });
});
