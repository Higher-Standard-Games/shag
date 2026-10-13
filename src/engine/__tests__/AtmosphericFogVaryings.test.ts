/**
 * Every shader stage that fogs by world position declares where it gets it.
 *
 * A fogged effect passes `vAtmWorld` from its vertex stage to its fragment
 * stage. A stage that uses it without declaring it does not compile, and the
 * effect never draws — which only shows on a map that has that effect.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const fogged = sources(join(__dirname, "..")).filter((path) => readFileSync(path, "utf8").includes("vAtmWorld"));

describe("fog varyings", () => {
  it("finds the fogged shaders", () => {
    expect(fogged.length).toBeGreaterThan(5);
  });

  it.each(fogged)("declares vAtmWorld in every stage of %s", (path) => {
    const source = readFileSync(path, "utf8");
    const stages = source.split("void main()").length - 1;
    const declarations = source.split("varying vec3 vAtmWorld;").length - 1;
    expect(declarations).toBe(stages);
  });
});
