/**
 * The desktop packaging config has to load, and electron-builder loads it by
 * `require`. This package is `"type": "module"`, so a `.js` config exports
 * nothing at all — electron-builder receives an empty object and packages a
 * nameless app — and the file's game manifest path has to point at a game that
 * exists. Both were broken at once, silently, because nothing ever loaded it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const loadConfig = (selection: string) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(require('./electron-builder.config.cjs')))"],
      { cwd: process.cwd(), env: { ...process.env, SHAG_APP: selection }, encoding: "utf8", windowsHide: true },
    ),
  );
const config = loadConfig("engine");
const pkg = require("../../package.json") as { scripts: Record<string, string> };

describe("electron-builder config", () => {
  it("exports a config rather than an empty module", () => {
    expect(Object.keys(config).length).toBeGreaterThan(0);
  });

  it("names the neutral engine without a game checkout", () => {
    expect(config.appId).toBe("com.shagengine.app");
    expect(config.productName).toBe("SHAG Engine");
  });

  it("reads the explicitly selected application's metadata", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shag-desktop-config-"));
    const manifest = path.join(directory, "game.json");
    try {
      fs.writeFileSync(
        manifest,
        JSON.stringify({ name: "example", displayName: "Example App", desktop: { appId: "example.app" } }),
      );
      const selected = loadConfig(directory);
      expect(selected.appId).toBe("example.app");
      expect(selected.productName).toBe("Example App");
      expect(selected.nsis.shortcutName).toBe("Example App");
    } finally {
      fs.unlinkSync(manifest);
      fs.rmdirSync(directory);
    }
  });

  it("packages the web build and the compiled electron processes", () => {
    expect(config.files).toEqual(expect.arrayContaining(["dist/**/*", "dist-electron/**/*"]));
    expect(config.directories.output).toContain("release/");
  });

  it("is the file the build script passes", () => {
    expect(pkg.scripts["electron:build"]).toContain("electron-builder.config.cjs");
  });
});
