/**
 * `findByPattern` takes a glob, and a PK3 path is full of characters a regex
 * reads as syntax: the dot in "maps/*.bsp", and the brackets, plus signs and
 * parentheses that texture names carry. Only `*` and `?` are wildcards; the
 * rest has to match itself.
 */

import { describe, expect, it } from "vitest";
import { PK3Index } from "../PK3Index";

const FILES: Record<string, string> = {
  "maps/wdm2.bsp": "data0.pk3",
  "maps/wdm2Xbsp": "data0.pk3",
  "maps/wbomb2.bsp": "data1.pk3",
  "textures/base_wall/c_met5_2+.tga": "data0.pk3",
  "textures/fx[1]/glow.tga": "data0.pk3",
  "sounds/mix(1)/hit.wav": "data0.pk3",
};

function indexOf(files: Record<string, string>): PK3Index {
  const index = PK3Index.getInstance();
  // biome-ignore lint/suspicious/noExplicitAny: seeds the private index for a pure lookup test
  (index as any).index = { files, shaders: {}, maps: {}, packages: {} };
  return index;
}

describe("findByPattern", () => {
  it("matches a glob without letting its dot match anything", () => {
    const found = indexOf(FILES)
      .findByPattern("maps/*.bsp")
      .map((entry) => entry.file)
      .sort();
    expect(found).toEqual(["maps/wbomb2.bsp", "maps/wdm2.bsp"]);
  });

  it("takes ? as exactly one character", () => {
    expect(
      indexOf(FILES)
        .findByPattern("maps/wdm?.bsp")
        .map((e) => e.file),
    ).toEqual(["maps/wdm2.bsp"]);
  });

  it("matches a name carrying regex characters, literally", () => {
    expect(
      indexOf(FILES)
        .findByPattern("textures/base_wall/c_met5_2+.tga")
        .map((e) => e.file),
    ).toEqual(["textures/base_wall/c_met5_2+.tga"]);
    expect(
      indexOf(FILES)
        .findByPattern("textures/fx[1]/*.tga")
        .map((e) => e.file),
    ).toEqual(["textures/fx[1]/glow.tga"]);
    expect(
      indexOf(FILES)
        .findByPattern("sounds/mix(1)/*.wav")
        .map((e) => e.file),
    ).toEqual(["sounds/mix(1)/hit.wav"]);
  });

  it("does not throw on an unbalanced bracket or parenthesis", () => {
    expect(() => indexOf(FILES).findByPattern("textures/fx[1/*.tga")).not.toThrow();
    expect(() => indexOf(FILES).findByPattern("sounds/mix(1/*.wav")).not.toThrow();
  });
});
