import { Tools } from "@babylonjs/core/Misc/tools";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  hostedDataBase,
  installHostedPublicUrls,
  resetPublicUrlsForTests,
  resolveCssUrls,
  resolvePublicUrl,
} from "../PublicUrls";

describe("public URLs", () => {
  const realFetch = globalThis.fetch;
  const realPreprocess = Tools.PreprocessUrl;
  const pageFetch = vi.fn(async () => new Response("ok"));

  beforeAll(() => {
    globalThis.fetch = pageFetch as unknown as typeof fetch;
  });
  afterEach(() => {
    resetPublicUrlsForTests();
    pageFetch.mockClear();
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    Tools.PreprocessUrl = realPreprocess;
  });

  it("leaves every path alone in a build served from its own site", () => {
    expect(resolvePublicUrl("/data/levelshots/dm2.jpg")).toBe("/data/levelshots/dm2.jpg");
    expect(resolvePublicUrl("/engine/fonts/a.woff2")).toBe("/engine/fonts/a.woff2");
    expect(hostedDataBase()).toBeNull();
  });

  it("sends /data to the region and keeps other root paths inside the build", async () => {
    installHostedPublicUrls({ dataBase: "https://eu.washoi.net/data/", buildBase: "./" });
    expect(resolvePublicUrl("/data/levelshots/dm2.jpg")).toBe("https://eu.washoi.net/data/levelshots/dm2.jpg");
    expect(resolvePublicUrl("/data")).toBe("https://eu.washoi.net/data");
    expect(resolvePublicUrl("/engine/fonts/a.woff2")).toBe("./engine/fonts/a.woff2");
    expect(resolvePublicUrl("/wasm/HavokPhysics.wasm")).toBe("./wasm/HavokPhysics.wasm");
    expect(hostedDataBase()).toBe("https://eu.washoi.net/data/");

    await fetch("/data/pk3_manifest.json");
    expect(pageFetch).toHaveBeenLastCalledWith("https://eu.washoi.net/data/pk3_manifest.json", undefined);
    expect(Tools.PreprocessUrl("/data/models/ra.glb")).toBe("https://eu.washoi.net/data/models/ra.glb");
  });

  it("sends page-relative data/ there too, and leaves other relative and absolute URLs alone", () => {
    installHostedPublicUrls({ dataBase: "https://eu.washoi.net/data", buildBase: "./" });
    expect(resolvePublicUrl("data/game.playlist.json")).toBe("https://eu.washoi.net/data/game.playlist.json");
    expect(resolvePublicUrl("./data/map.pk3?sha256=ab")).toBe("https://eu.washoi.net/data/map.pk3?sha256=ab");
    for (const url of [
      "database.json",
      "./assets/x.js",
      "https://us.washoi.net/data/x",
      "//cdn.example/x",
      "blob:https://x/1",
      "data:image/png;base64,AA",
    ]) {
      expect(resolvePublicUrl(url)).toBe(url);
    }
    // A sibling of /data is a build file, not region data
    expect(resolvePublicUrl("/database.json")).toBe("./database.json");
  });

  it("resolves root url()s in injected CSS text", () => {
    const css = `@font-face { src: url("/engine/fonts/a.ttf") } .x { background: url(/images/s.webp), url('//cdn/x.png'), url("data:image/png;base64,AA") }`;
    expect(resolveCssUrls(css)).toBe(css);
    installHostedPublicUrls({ dataBase: "https://eu.washoi.net/data", buildBase: "./" });
    expect(resolveCssUrls(css)).toBe(
      `@font-face { src: url("./engine/fonts/a.ttf") } .x { background: url(./images/s.webp), url('//cdn/x.png'), url("data:image/png;base64,AA") }`,
    );
  });
});
