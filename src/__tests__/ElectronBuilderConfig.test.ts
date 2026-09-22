/**
 * The desktop packaging config has to load, and electron-builder loads it by
 * `require`. This package is `"type": "module"`, so a `.js` config exports
 * nothing at all — electron-builder receives an empty object and packages a
 * nameless app — and the file's game manifest path has to point at a game that
 * exists. Both were broken at once, silently, because nothing ever loaded it.
 */

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// biome-ignore lint/suspicious/noExplicitAny: the config is plain JSON-shaped data
const config = require("../../electron-builder.config.cjs") as any;
const pkg = require("../../package.json") as { scripts: Record<string, string> };

describe("electron-builder config", () => {
  it("exports a config rather than an empty module", () => {
    expect(Object.keys(config).length).toBeGreaterThan(0);
  });

  it("names the app from the selected game's manifest", () => {
    expect(config.appId).toBeTruthy();
    expect(config.productName).toBe("Washiki Washoi!");
  });

  it("packages the web build and the compiled electron processes", () => {
    expect(config.files).toEqual(expect.arrayContaining(["dist/**/*", "dist-electron/**/*"]));
    expect(config.directories.output).toContain("release/");
  });

  it("is the file the build script passes", () => {
    expect(pkg.scripts["electron:build"]).toContain("electron-builder.config.cjs");
  });
});
