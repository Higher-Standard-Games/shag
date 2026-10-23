/**
 * MapLoader.disposeCurrentMap releases the preloaded pickup models, and only
 * after the pickups cloned from them are gone, so no live clone loses them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetPreloader } from "../../AssetPreloader";
import { clearGameMapEntities, registerGameMapEntities } from "../GameMapEntities";
import { MapLoader } from "../MapLoader";

vi.mock("../../../physics/PhysicsSystem", () => ({
  PhysicsSystem: { getInstance: () => ({ createStaticBody: () => {} }) },
}));

afterEach(() => {
  clearGameMapEntities();
  vi.restoreAllMocks();
});

describe("MapLoader.disposeCurrentMap", () => {
  it("releases preloaded pickup models after disposing the map's pickups", async () => {
    const order: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    registerGameMapEntities({
      initializeDefinitions() {},
      registerHandlers() {},
      disposeMapEntities() {
        order.push("pickups");
      },
    });
    vi.spyOn(AssetPreloader.getInstance(), "clearCache").mockImplementation(() => {
      order.push("models");
    });

    await MapLoader.getInstance().disposeCurrentMap();

    expect(order).toEqual(["pickups", "models"]);
  });

  it("releases models without a game adapter", async () => {
    clearGameMapEntities();
    const clear = vi.spyOn(AssetPreloader.getInstance(), "clearCache");
    await expect(MapLoader.getInstance().disposeCurrentMap()).resolves.toBeUndefined();
    expect(clear).toHaveBeenCalledOnce();
  });
});
