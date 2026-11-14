import { describe, expect, it } from "vitest";
import { extractLocations, locationName, plainLocationName } from "../LocationTable";

describe("map locations", () => {
  it("strips Warsow colour codes from names", () => {
    expect(plainLocationName("^3Warehouse ^1A")).toBe("Warehouse A");
    expect(plainLocationName("^7Old  Town ")).toBe("Old Town");
  });

  it("reads named target_location entities in Babylon coordinates", () => {
    const locations = extractLocations([
      { classname: "target_location", origin: "100 200 30", message: "^7Station" },
      { classname: "target_location", origin: "0 0 0" },
      { classname: "light", origin: "0 0 0", message: "x" },
    ]);
    expect(locations).toEqual([{ name: "Station", position: { x: 100, y: 30, z: 200 } }]);
  });

  it("reads entities whose keys sit under properties too", () => {
    const locations = extractLocations([
      { classname: "target_location", properties: { origin: "1 2 3", message: "^2Yard" } },
    ]);
    expect(locations).toEqual([{ name: "Yard", position: { x: 1, y: 3, z: 2 } }]);
  });

  it("names a point by the nearest location", () => {
    const locations = extractLocations([
      { classname: "target_location", origin: "0 0 0", message: "A" },
      { classname: "target_location", origin: "1000 0 0", message: "B" },
    ]);
    expect(locationName(locations, { x: 900, y: 0, z: 0 })).toBe("B");
    expect(locationName(locations, { x: 100, y: 0, z: 0 })).toBe("A");
    expect(locationName([], { x: 0, y: 0, z: 0 })).toBeNull();
  });
});
