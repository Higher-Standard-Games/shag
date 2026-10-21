// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { DamageOverlay } from "../DamageOverlay";

afterEach(() => {
  DamageOverlay.getInstance().destroy();
  vi.restoreAllMocks();
});

it("takes its screen-sized canvas out of the page while no hit is showing", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform() {},
    clearRect() {},
  } as never);
  const overlay = DamageOverlay.getInstance();
  const canvas = document.getElementById("damage-overlay") as HTMLCanvasElement;
  expect(canvas.style.display).toBe("none");

  overlay.show(0, 0);
  expect(canvas.style.display).toBe("");
  // The flash ends after its fade; a late frame finds nothing left to draw
  (overlay as unknown as { flashes: unknown[] }).flashes = [];
  frames.shift()?.(performance.now() + 5000);
  expect(canvas.style.display).toBe("none");
});
