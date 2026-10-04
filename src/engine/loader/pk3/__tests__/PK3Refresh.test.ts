import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PK3Index } from "../PK3Index";

afterEach(() => {
  vi.unstubAllGlobals();
  PK3Index.getInstance().clear();
});

describe("targeted PK3 refresh", () => {
  it("indexes only the named package family and lets its newest map win", async () => {
    const zip = async (value: number) => {
      const archive = new JSZip();
      archive.file("maps/testarena.bsp", Uint8Array.from([value]));
      return archive.generateAsync({ type: "uint8array" });
    };
    const files = new Map([
      ["/data/map_testarena_00001.pk3", await zip(1)],
      ["/data/map_testarena_00002.pk3", await zip(2)],
    ]);
    const sibling = new JSZip();
    sibling.file("maps/otherarena.bsp", Uint8Array.from([3]));
    files.set("/data/map_testarena_variant.pk3", await sibling.generateAsync({ type: "uint8array" }));
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requests.push(url);
      if (url === "/data/pk3_manifest.json")
        return new Response(
          JSON.stringify({
            files: ["basewsw.pk3", "map_testarena_00001.pk3", "map_testarena_00002.pk3", "map_testarena_variant.pk3"],
          }),
        );
      const bytes = files.get(url);
      return bytes ? new Response(Uint8Array.from(bytes)) : new Response("missing", { status: 404 });
    });
    const index = PK3Index.getInstance();
    index.clear();
    index.setSearchPaths(["/data/"]);
    expect(await index.refreshFamily("map_testarena.pk3")).toEqual([
      "map_testarena_00001.pk3",
      "map_testarena_00002.pk3",
      "map_testarena_variant.pk3",
    ]);
    expect(index.findMap("testarena")).toBe("map_testarena_00002.pk3");
    expect(requests).not.toContain("/data/basewsw.pk3");
  });
});
