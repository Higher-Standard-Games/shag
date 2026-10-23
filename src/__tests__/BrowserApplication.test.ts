import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browserApplicationPlugin, resolveBrowserApplication } from "../../scripts/browser-application";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shag-browser-"));
  roots.push(root);
  const game = path.join(root, "custom-game");
  mkdirSync(game);
  writeFileSync(path.join(game, "browser.json"), JSON.stringify({ entry: "boot.ts", html: "page.html" }));
  writeFileSync(path.join(game, "boot.ts"), "export {};");
  writeFileSync(path.join(game, "page.html"), "<title>Custom game</title><!-- SHAG_APPLICATION_ENTRY -->");
  return { root, game };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("browser application composition", () => {
  it("selects the engine without a game checkout or local configuration", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "shag-engine-"));
    roots.push(root);
    expect(resolveBrowserApplication(root)).toEqual({
      directory: root,
      entry: path.join(root, "src/main.ts"),
      html: null,
    });
  });

  it("resolves arbitrary game paths and allows an explicit engine override", () => {
    const { root, game } = fixture();
    writeFileSync(path.join(root, ".shag-application.json"), '\uFEFF{"application":"custom-game"}');
    expect(resolveBrowserApplication(root).directory).toBe(game);
    expect(resolveBrowserApplication(root, "engine").html).toBeNull();
    expect(resolveBrowserApplication(root, game).directory).toBe(game);
  });

  it("fails explicitly for missing or malformed applications", () => {
    const { root, game } = fixture();
    expect(() => resolveBrowserApplication(root, "missing")).toThrow();
    writeFileSync(path.join(game, "browser.json"), '{"entry":"boot.ts"}');
    expect(() => resolveBrowserApplication(root, "custom-game")).toThrow("requires html");
  });

  it("uses the selected HTML at the root URL and preserves unrelated pages", () => {
    const { root } = fixture();
    const plugin = browserApplicationPlugin(root, resolveBrowserApplication(root, "custom-game"));
    const hook = plugin.transformIndexHtml as { handler: (html: string, context: { filename: string }) => string };
    const html = hook.handler("engine template", { filename: path.join(root, "index.html") });
    expect(html).toContain("<title>Custom game</title>");
    expect(html).toContain('src="/custom-game/boot.ts"');
    expect(hook.handler("mockup", { filename: path.join(root, "other.html") })).toBe("mockup");
    expect(readFileSync(path.join(root, "custom-game/page.html"), "utf8")).toContain("SHAG_APPLICATION_ENTRY");
  });

  it("serves an explicitly selected application outside the engine root", () => {
    const { root, game } = fixture();
    const engine = path.join(root, "engine");
    mkdirSync(engine);
    const plugin = browserApplicationPlugin(engine, resolveBrowserApplication(engine, game));
    const hook = plugin.transformIndexHtml as { handler: (html: string, context: { filename: string }) => string };
    expect(hook.handler("", { filename: path.join(engine, "index.html") })).toContain('src="/@fs/');
  });
});
