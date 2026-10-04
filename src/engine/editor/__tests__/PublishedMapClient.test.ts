import { createHash, webcrypto } from "node:crypto";
import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { PK3Index } from "../../loader/pk3/PK3Index";
import { PK3Loader } from "../../loader/pk3/PK3Loader";
import { preparePublishedMap } from "../PublishedMapClient";

afterEach(() => {
  vi.unstubAllGlobals();
  PK3Index.getInstance().clear();
});

it("refreshes and verifies one published BSP without scanning the whole PK3 manifest", async () => {
  const name = `clientprobe_${Date.now()}`;
  const packageName = `map_${name}_00001.pk3`;
  const bsp = Uint8Array.from([70, 66, 83, 80, 1, 0, 0, 0]);
  const bspHash = createHash("sha256").update(bsp).digest("hex");
  const zip = new JSZip();
  zip.file(`maps/${name}.bsp`, bsp);
  const archive = Uint8Array.from(await zip.generateAsync({ type: "uint8array" }));
  const requests: string[] = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    if (url === `data/shagged_${name}.json`)
      return new Response(JSON.stringify({ mapName: name, package: packageName, buildId: "job", bspHash }));
    if (url === `data/${packageName}`) return new Response(archive);
    return new Response("missing", { status: 404 });
  });
  PK3Index.getInstance().clear();
  PK3Index.getInstance().setSearchPaths(["data/"]);
  await PK3Loader.getInstance().init();
  expect(await preparePublishedMap(name, "job")).toMatchObject({ package: packageName, bspHash });
  expect(PK3Index.getInstance().findMap(name)).toBe(packageName);
  expect(requests).not.toContain("data/pk3_manifest.json");
});
