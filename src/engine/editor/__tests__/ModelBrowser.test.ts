// @vitest-environment jsdom

/** The model browser drawer on a fake path list, with a preview that resolves on demand. */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelBounds } from "../EditorModelAsset";
import { ModelBrowser, modelFolder, searchModels } from "../ModelBrowser";
import type { ModelPreview } from "../ModelTurntable";

const PATHS = [
  "models/mapobjects/boqu/boqu.md3",
  "models/mapobjects/jumppad1/jumppad.md3",
  "models/objects/misc/barrel.md3",
  "models/props/crate.glb",
];

const CRATE: ModelBounds = { min: { x: -16, y: -16, z: -8 }, max: { x: 16, y: 16, z: 24 } };

function setup(inMap: string[] = []) {
  const pending = new Map<string, (bounds: ModelBounds | null) => void>();
  const preview: ModelPreview = {
    show: vi.fn((path: string) => new Promise<ModelBounds | null>((resolve) => pending.set(path, resolve))),
    clear: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  const onPick = vi.fn();
  const browser = new ModelBrowser({ paths: () => PATHS, inMap: () => inMap, preview: () => preview, onPick });
  document.body.appendChild(browser.element);
  browser.open();
  const rows = () => [...browser.element.querySelectorAll<HTMLElement>(".shagged-models__row")];
  const click = (path: string, detail = 1) =>
    rows()
      .find((row) => row.dataset.path === path)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
  return { browser, preview, pending, onPick, rows, click };
}

afterEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe("model browser helpers", () => {
  it("groups by the folder under models/ and searches every term", () => {
    expect(modelFolder("models/objects/misc/barrel.md3")).toBe("objects/misc");
    expect(modelFolder("models/crate.glb")).toBe("models");
    expect(searchModels(PATHS, "map md3")).toEqual(PATHS.slice(0, 2));
    expect(searchModels(PATHS, "CRATE")).toEqual(["models/props/crate.glb"]);
  });
});

describe("ModelBrowser", () => {
  it("lists every path, filters by folder and search, and starts its preview on open", () => {
    const { browser, preview, rows } = setup();
    expect(preview.start).toHaveBeenCalled();
    expect(rows()).toHaveLength(4);
    browser.element.querySelector<HTMLButtonElement>('button[data-group*="objects/misc"]')!.click();
    expect(rows().map((row) => row.dataset.path)).toEqual(["models/objects/misc/barrel.md3"]);
    browser.element.querySelector<HTMLButtonElement>('button[data-group*="all"]')!.click();
    const search = browser.element.querySelector<HTMLInputElement>(".shagged-models__search")!;
    search.value = "jump";
    search.dispatchEvent(new Event("input"));
    expect(rows().map((row) => row.dataset.path)).toEqual(["models/mapobjects/jumppad1/jumppad.md3"]);
  });

  it("previews on click and shows the model's size", async () => {
    const { browser, preview, pending, click } = setup();
    click("models/props/crate.glb");
    expect(preview.show).toHaveBeenCalledWith("models/props/crate.glb");
    pending.get("models/props/crate.glb")!(CRATE);
    await vi.waitFor(() =>
      expect(browser.element.querySelector(".shagged-models__caption")!.textContent).toBe(
        "models/props/crate.glb · 32×32×32 units",
      ),
    );
  });

  it("hands a double-clicked model over with its bounds once the preview measured it, then closes", async () => {
    const { browser, pending, onPick, click } = setup();
    click("models/props/crate.glb");
    click("models/props/crate.glb", 2);
    expect(browser.isOpen).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
    pending.get("models/props/crate.glb")!(CRATE);
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith("models/props/crate.glb", CRATE, true));
    expect(browser.recent()).toEqual(["models/props/crate.glb"]);
  });

  it("picks with null bounds when the preview fails, and lists the map's models", async () => {
    const { browser, preview, onPick, rows } = setup(["models/objects/misc/barrel.md3"]);
    vi.mocked(preview.show).mockRejectedValueOnce(new Error("not in any package"));
    browser.element.querySelector<HTMLButtonElement>('button[data-group*="inMap"]')!.click();
    expect(rows().map((row) => row.dataset.path)).toEqual(["models/objects/misc/barrel.md3"]);
    rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    browser.element.querySelector<HTMLButtonElement>(".shagged-models__use")!.click();
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith("models/objects/misc/barrel.md3", null, false));
    expect(browser.isOpen).toBe(true);
    expect(browser.element.querySelector(".shagged-models__caption")!.textContent).toContain("not in any package");
  });

  it("stops the preview when closed and disposes it with the drawer", () => {
    const { browser, preview } = setup();
    browser.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(browser.isOpen).toBe(false);
    expect(preview.stop).toHaveBeenCalled();
    browser.dispose();
    expect(preview.dispose).toHaveBeenCalled();
  });
});
