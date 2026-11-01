// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { DamageOverlay } from "../DamageOverlay";

afterEach(() => {
  DamageOverlay.getInstance().destroy();
  vi.restoreAllMocks();
});

function layers(): HTMLElement[] {
  return [...(document.getElementById("damage-overlay")?.children ?? [])] as HTMLElement[];
}

it("draws nothing per frame: a hit only starts opacity animations", () => {
  const raf = vi.spyOn(window, "requestAnimationFrame");
  const animations: Array<{ el: HTMLElement; frames: Keyframe[]; cancel: () => void }> = [];
  HTMLElement.prototype.animate = function (this: HTMLElement, frames: Keyframe[]) {
    const animation = { el: this, frames, cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  } as never;

  const overlay = DamageOverlay.getInstance();
  // Idle layers sit at opacity 0, which the browser leaves out of the frame
  expect(layers().every((layer) => layer.style.opacity === "0")).toBe(true);

  overlay.show(50, 0); // full damage from the right
  expect(raf).not.toHaveBeenCalled();
  for (const a of animations) expect(a.frames.map((f) => Object.keys(f))).toEqual([["opacity"], ["opacity"]]);
  // Vignette and the right edge; the left edge faces away and stays dark
  expect(animations).toHaveLength(2);
  expect(animations[1].el).toBe(layers()[1]);

  // A second hit stacks onto what is still showing and replaces the fade
  overlay.show(50, 0);
  expect(animations[0].cancel).toHaveBeenCalled();
  expect(Number(animations[2].frames[0].opacity)).toBeGreaterThan(Number(animations[0].frames[0].opacity));

  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});
