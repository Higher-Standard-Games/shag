/**
 * Cube faces must all be the same size, but Quake-era authors stub the face
 * nobody looks at. wbomb6 ships a 1x1 grey `_dn` beside five 512x512 faces, and
 * reading that 4-byte face as 512x512 malformed the cube and lost the whole sky.
 *
 * This is tested as a pure function on purpose: NullEngine cannot construct a
 * RawCubeTexture at all (a trivial 4x4 cube throws on a missing GL constant), so
 * the assembled skybox itself is only verifiable in a browser.
 */

import { describe, expect, it } from "vitest";
import { scaleFaceTo } from "../loader/texture/SkyboxLoader";

/** A `size` x `size` RGBA face filled with one colour. */
function solid(size: number, [r, g, b, a]: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([r, g, b, a], i * 4);
  return data;
}

describe("cube face scaling", () => {
  it("returns the same buffer when the face already matches", () => {
    const face = solid(4, [1, 2, 3, 4]);
    expect(scaleFaceTo(face, 4, 4)).toBe(face);
  });

  it("expands a 1x1 stub into a full face of its own colour", () => {
    const stub = solid(1, [10, 20, 30, 255]);
    const scaled = scaleFaceTo(stub, 1, 512);

    expect(scaled.length).toBe(512 * 512 * 4);
    // Every pixel, not just the first — a partial fill would show as a seam.
    // Counted in one pass and asserted once, rather than a quarter-million
    // assertions that would dominate the suite's runtime.
    let wrong = 0;
    for (let i = 0; i < 512 * 512; i++) {
      if (scaled[i * 4] !== 10 || scaled[i * 4 + 1] !== 20 || scaled[i * 4 + 2] !== 30 || scaled[i * 4 + 3] !== 255) {
        wrong++;
      }
    }
    expect(wrong).toBe(0);
  });

  it("keeps a scaled face's corners where they belong", () => {
    // A 2x2 with four distinct pixels must land as four quadrants, not smeared:
    // this is what catches an inverted axis or an off-by-one in the mapping.
    const src = new Uint8Array([
      ...[255, 0, 0, 255], // top-left
      ...[0, 255, 0, 255], // top-right
      ...[0, 0, 255, 255], // bottom-left
      ...[255, 255, 0, 255], // bottom-right
    ]);
    const scaled = scaleFaceTo(src, 2, 4);
    const at = (x: number, y: number) => Array.from(scaled.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));

    expect(at(0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(3, 0)).toEqual([0, 255, 0, 255]);
    expect(at(0, 3)).toEqual([0, 0, 255, 255]);
    expect(at(3, 3)).toEqual([255, 255, 0, 255]);
  });

  it("never reads past a degenerate source", () => {
    expect(() => scaleFaceTo(new Uint8Array(0), 0, 64)).not.toThrow();
  });
});
