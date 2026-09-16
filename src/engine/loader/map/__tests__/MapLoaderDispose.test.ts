/**
 * MapLoader.disposeCurrentMap releases the preloaded pickup models, and only
 * after the pickups cloned from them are gone, so no live clone loses them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityManager } from "../../../entities/EntityManager";
import { AssetPreloader } from "../../AssetPreloader";
import { MapLoader } from "../MapLoader";

vi.mock("../../../physics/PhysicsSystem", () => ({
  PhysicsSystem: { getInstance: () => ({ createStaticBody: () => {} }) },
}));

afterEach(() => vi.restoreAllMocks());

describe("MapLoader.disposeCurrentMap", () => {
  it("releases preloaded pickup models after disposing the map's pickups", async () => {
    const order: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(EntityManager.getInstance(), "disposeMapEntities").mockImplementation(() => {
      order.push("pickups");
    });
    vi.spyOn(AssetPreloader.getInstance(), "clearCache").mockImplementation(() => {
      order.push("models");
    });

    await MapLoader.getInstance().disposeCurrentMap();

    expect(order).toEqual(["pickups", "models"]);
  });
});
