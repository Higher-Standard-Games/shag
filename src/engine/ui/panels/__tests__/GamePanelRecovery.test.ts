// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GamePanel } from "../GamePanel";

function panel() {
  // Use the real open/close lifecycle with a plain DOM root, without rendering a logo.
  const root = document.body.appendChild(document.createElement("div"));
  const view = Object.create(GamePanel.prototype) as GamePanel;
  const closed = vi.fn();
  Object.assign(view, {
    root,
    centerZone: root,
    visible: true,
    particles: [],
    logoCanvas: null,
    closingHandler: null,
    kanjiElements: [],
    escHandler: () => {},
    onCloseCallback: closed,
  });
  return { view, root, closed };
}
afterEach(() => {
  document.body.replaceChildren();
  document.body.classList.remove("show-ui-bg");
});

describe("menu recovery during its closing animation", () => {
  it("does not hide a reopened menu when an obsolete close animation finishes", () => {
    const { view, root, closed } = panel();
    view.close();
    view.open();
    root.dispatchEvent(new Event("animationend"));
    expect(root.style.display).not.toBe("none");
    expect(view.isOpen()).toBe(true);
    expect(closed).not.toHaveBeenCalled();
    view.close();
    root.dispatchEvent(new Event("animationend"));
    expect(closed).toHaveBeenCalledOnce();
    expect(root.style.display).toBe("none");
    view.destroy();
  });

  it("ignores child animation completions and removes pending handlers on destruction", () => {
    const { view, root, closed } = panel();
    const child = root.appendChild(document.createElement("div"));
    view.close();
    child.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(closed).not.toHaveBeenCalled();
    view.destroy();
    root.dispatchEvent(new Event("animationend"));
    expect(closed).not.toHaveBeenCalled();
  });
});
