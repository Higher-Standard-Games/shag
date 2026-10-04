import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { publishBuild, readPublishedBuild } from "../PublishedBuild";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("SHAGGED published builds", () => {
  it("allocates distinct numbers when two processes publish the same map concurrently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-publish-"));
    roots.push(root);
    const input = { mapName: "parallel", buildId: "one", sourceRevision: 1, sourceHash: "source", quality: "fast" };
    const builds = await Promise.all([
      publishBuild(root, input, Uint8Array.from([1])),
      publishBuild(root, { ...input, buildId: "two" }, Uint8Array.from([2])),
    ]);
    expect(builds.map((build) => build.package).sort()).toEqual(["map_parallel_00001.pk3", "map_parallel_00002.pk3"]);
    expect(builds).toContainEqual(await readPublishedBuild(root, "parallel"));
  });

  it("keeps both manifest entries when different maps publish concurrently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-publish-"));
    roots.push(root);
    const input = { mapName: "one", buildId: "one", sourceRevision: 1, sourceHash: "source", quality: "fast" };
    await Promise.all([
      publishBuild(root, input, Uint8Array.from([1])),
      publishBuild(root, { ...input, mapName: "two", buildId: "two" }, Uint8Array.from([2])),
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, "pk3_manifest.json"), "utf8"));
    expect(manifest.files).toEqual(["map_one_00001.pk3", "map_two_00001.pk3"]);
  });

  it("keeps numbered BSP packages and points to the latest successful publication", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-publish-"));
    roots.push(root);
    await writeFile(path.join(root, "pk3_manifest.json"), JSON.stringify({ files: ["basewsw.pk3"] }));
    const input = { mapName: "arena", buildId: "one", sourceRevision: 1, sourceHash: "source", quality: "fast" };
    const first = await publishBuild(root, input, Uint8Array.from([1, 2, 3]));
    const second = await publishBuild(root, { ...input, buildId: "two", sourceRevision: 2 }, Uint8Array.from([4, 5]));
    expect(first.package).toBe("map_arena_00001.pk3");
    expect(second.package).toBe("map_arena_00002.pk3");
    expect(await readPublishedBuild(root, "arena")).toEqual(second);
    const zip = await JSZip.loadAsync(Uint8Array.from(await readFile(path.join(root, second.package))));
    expect(await zip.file("maps/arena.bsp")?.async("uint8array")).toEqual(Uint8Array.from([4, 5]));
    const manifest = JSON.parse(await readFile(path.join(root, "pk3_manifest.json"), "utf8"));
    expect(manifest.files).toEqual(["basewsw.pk3", first.package, second.package]);
    await expect(publishBuild(root, { ...input, mapName: "../escape" }, Uint8Array.from([1]))).rejects.toThrow();
    expect(await readPublishedBuild(root, "arena")).toEqual(second);
    await writeFile(path.join(root, "map_installed.pk3"), "existing");
    await expect(publishBuild(root, { ...input, mapName: "installed" }, Uint8Array.from([1]))).rejects.toThrow(
      "collides",
    );
  });
});
