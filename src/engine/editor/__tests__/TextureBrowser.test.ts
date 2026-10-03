// @vitest-environment jsdom

/**
 * The texture browser drawer on a small fake catalog. jsdom has no
 * IntersectionObserver, so every rendered tile loads its thumbnail at once;
 * paging is exercised through the sentinel and the keyboard instead.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextureBrowser } from "../TextureBrowser";
import type { TextureEntry } from "../TextureCatalog";
import type { TextureThumbnails } from "../TextureThumbnails";

const entry = (name: string, extra: Partial<TextureEntry> = {}): TextureEntry => ({
  name,
  folder: name.split("/")[0],
  image: `textures/${name}.tga`,
  hasShader: false,
  tags: [],
  compiler: false,
  sky: false,
  transparent: false,
  nolightmap: false,
  fog: false,
  solidColor: false,
  missing: false,
  ...extra,
});

const ENTRIES = [
  entry("blx/blx_dark"),
  entry("blx/blx_grid"),
  entry("blx/blx_white_stripe"),
  entry("boqu/floor"),
  entry("common/caulk", { compiler: true, tags: ["Stock / Compiler"] }),
  entry("broken/thing", { image: null, missing: true }),
];

function setup(pageSize = 50) {
  const thumbnails = {
    request: vi.fn(async (path: string) => ({
      url: `blob:${path}`,
      width: path.includes("stripe") ? 128 : 256,
      height: path.includes("stripe") ? 32 : 256,
    })),
    cancel: vi.fn(),
  } as unknown as TextureThumbnails;
  const onApply = vi.fn();
  const onClose = vi.fn();
  const browser = new TextureBrowser({
    catalog: async () => ENTRIES,
    thumbnails,
    inMap: () => ["boqu/floor", "blx/blx_dark", "not/in/catalog"],
    onApply,
    onClose,
    pageSize,
  });
  document.body.appendChild(browser.element);
  const tiles = () => [...browser.element.querySelectorAll<HTMLElement>(".shagged-tex__tile")];
  const names = () => tiles().map((tile) => tile.title.split(" · ")[0]);
  const group = (label: string) =>
    [...browser.element.querySelectorAll<HTMLButtonElement>(".shagged-tex__groups button")]
      .find((button) => button.firstChild?.textContent === label)!
      .click();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { browser, thumbnails, onApply, onClose, tiles, names, group, flush };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("texture browser", () => {
  it("opens on the full catalog with tag and folder groups, and filters by group and search", async () => {
    const t = setup();
    expect(t.browser.isOpen).toBe(false);
    await t.browser.open();
    expect(t.browser.isOpen).toBe(true);
    expect(t.tiles()).toHaveLength(6);
    const labels = [...t.browser.element.querySelectorAll(".shagged-tex__groups button")].map((b) => b.textContent);
    expect(labels).toEqual([
      "All6",
      "Recent",
      "In this map",
      "Stock / Compiler1",
      "blx3",
      "boqu1",
      "broken1",
      "common1",
    ]);

    t.group("blx");
    expect(t.names()).toEqual(["blx/blx_dark", "blx/blx_grid", "blx/blx_white_stripe"]);
    const search = t.browser.element.querySelector<HTMLInputElement>(".shagged-tex__search")!;
    search.value = "stripe";
    search.dispatchEvent(new Event("input"));
    expect(t.names()).toEqual(["blx/blx_white_stripe"]);
    search.value = "";
    search.dispatchEvent(new Event("input"));
    t.group("In this map");
    expect(t.names()).toEqual(["blx/blx_dark", "boqu/floor"]);
    t.group("Stock / Compiler");
    expect(t.names()).toEqual(["common/caulk"]);
    expect(t.browser.element.querySelector(".shagged-tex__foot")!.textContent).toBe("1 textures");
  });

  it("applies a tile with its image size, remembers it as recent, and closes on double-click", async () => {
    const t = setup();
    await t.browser.open();
    await t.flush();
    const stripe = t.tiles().find((tile) => tile.title.startsWith("blx/blx_white_stripe"))!;
    expect(stripe.title).toBe("blx/blx_white_stripe · 128×32");
    stripe.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await t.flush();
    expect(t.onApply).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "blx/blx_white_stripe" }),
      [128, 32],
      false,
    );
    expect(t.browser.isOpen).toBe(true);
    t.group("Recent");
    expect(t.names()).toEqual(["blx/blx_white_stripe"]);

    t.group("All");
    t.tiles()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    await t.flush();
    expect(t.onApply).toHaveBeenLastCalledWith(expect.objectContaining({ name: "blx/blx_dark" }), [256, 256], true);
    expect(t.browser.isOpen).toBe(false);
    expect(t.onClose).toHaveBeenCalledTimes(1);
    expect(t.browser.recent()).toEqual(["blx/blx_dark", "blx/blx_white_stripe"]);
  });

  it("shows a missing texture as such and applies it without a size", async () => {
    const t = setup();
    await t.browser.open();
    const missing = t.tiles().find((tile) => tile.title === "broken/thing")!;
    expect(missing.classList.contains("shagged-tex__tile--missing")).toBe(true);
    expect(missing.textContent).toContain("missing");
    missing.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await t.flush();
    expect(t.onApply).toHaveBeenLastCalledWith(expect.objectContaining({ name: "broken/thing" }), null, false);
  });

  it("renders in pages and extends the page as the keyboard moves past it", async () => {
    const t = setup(2);
    await t.browser.open();
    expect(t.tiles()).toHaveLength(2);
    expect(t.browser.element.querySelector(".shagged-tex__more")).not.toBeNull();
    const grid = t.browser.element.querySelector<HTMLElement>(".shagged-tex__grid")!;
    t.tiles()[0].focus();
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(t.tiles().length).toBeGreaterThan(2);
    expect(document.activeElement).toBe(t.tiles()[1]);
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await t.flush();
    expect(t.onApply).toHaveBeenLastCalledWith(expect.objectContaining({ name: "blx/blx_grid" }), [256, 256], false);
    const outside = vi.fn();
    document.body.addEventListener("keydown", outside);
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    expect(document.activeElement).toBe(t.browser.element.querySelector(".shagged-tex__search"));
    // the drawer's keys stay in the drawer, away from the editor's shortcuts
    expect(outside).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", outside);
    t.browser.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(t.browser.isOpen).toBe(false);
  });

  it("loads the catalog once across opens", async () => {
    const catalog = vi.fn(async () => ENTRIES);
    const browser = new TextureBrowser({
      catalog,
      thumbnails: { request: vi.fn(async () => null), cancel: vi.fn() } as unknown as TextureThumbnails,
      inMap: () => [],
      onApply: vi.fn(),
    });
    document.body.appendChild(browser.element);
    await browser.open();
    browser.close();
    await browser.open();
    expect(catalog).toHaveBeenCalledTimes(1);
  });
});
