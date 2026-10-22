import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, expect, it } from "vitest";
import { indexWithMasterBank } from "../map-media";
import { generatePk3Index } from "../pk3-index-build";
import { parsePackagePolicy, publishedPackageNames, sharedPackageForPath } from "../pk3-package-policy";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it("accepts exact case-insensitive package names and rejects paths, globs and misspelled fields", () => {
  const policy = parsePackagePolicy({ ignoredPackages: ["MASTER.PK3"] });
  expect(publishedPackageNames(["z.pk3", "master.pk3", "a.pk3", "notes.txt"], policy)).toEqual(["a.pk3", "z.pk3"]);
  for (const value of [
    null,
    {},
    { ignorePackages: [] },
    { ignoredPackages: "master.pk3" },
    { ignoredPackages: ["../master.pk3"] },
    { ignoredPackages: ["tex_*.pk3"] },
    { ignoredPackages: ["a.pk3", "A.PK3"] },
  ])
    expect(() => parsePackagePolicy(value)).toThrow();
});

it("routes shared texture prefixes without accepting traversal or ambiguous ownership", () => {
  const policy = parsePackagePolicy({
    ignoredPackages: [],
    sharedTexturePackages: { "tex_billboard.pk3": { prefixes: ["textures/billboard/"], dynamic: true } },
  });
  expect(sharedPackageForPath("Textures/Billboard/bigbill1.png", policy)).toBe("tex_billboard.pk3");
  expect(sharedPackageForPath("textures/boqu/logo.png", policy)).toBeNull();
  for (const shared of [
    { "tex_bad.pk3": { prefixes: ["textures/../billboard/"], dynamic: true } },
    { "tex_a.pk3": { prefixes: ["textures/"] }, "tex_b.pk3": { prefixes: ["textures/billboard/"] } },
  ])
    expect(() => parsePackagePolicy({ ignoredPackages: [], sharedTexturePackages: shared })).toThrow();
});

it("publishes only selected packages and leaves a corrupt ignored source bank untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shag-package-policy-"));
  directories.push(directory);
  const master = "development source bank, deliberately not a ZIP";
  await writeFile(join(directory, "washoi_textures.pk3"), master);
  const bank = new JSZip()
    .file("textures/map.tga", "texture")
    .file("scripts/map.shader", "textures/map { { map textures/map.tga } }");
  await writeFile(join(directory, "tex_map.pk3"), await bank.generateAsync({ type: "uint8array" }));
  const report = await generatePk3Index(directory);
  const manifest = JSON.parse(await readFile(join(directory, "pk3_manifest.json"), "utf8"));
  const index = JSON.parse(await readFile(join(directory, "pk3_index.json"), "utf8"));
  expect(manifest.files).toEqual(["tex_map.pk3"]);
  expect(report.ignoredPackages).toEqual(["washoi_textures.pk3"]);
  expect(index.files["textures/map.tga"]).toBe("tex_map.pk3");
  expect(index.shaders["textures/map"]).toBe("tex_map.pk3");
  expect(index.packages.map((entry: { pk3: string }) => entry.pk3)).toEqual(["tex_map.pk3"]);
  expect(await readFile(join(directory, "washoi_textures.pk3"), "utf8")).toBe(master);
});

it("rebuilds source lookup from the ignored master instead of stale map banks without publishing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shag-master-bank-"));
  directories.push(directory);
  for (const [filename, value] of [
    ["tex_map.pk3", "stale"],
    ["washoi_textures.pk3", "edited master"],
  ]) {
    const zip = new JSZip().file("textures/shared.tga", value);
    await writeFile(join(directory, filename), await zip.generateAsync({ type: "uint8array" }));
  }
  await generatePk3Index(directory);
  const before = await readFile(join(directory, "pk3_index.json"), "utf8");
  const source = await indexWithMasterBank(directory, JSON.parse(before), "washoi_textures.pk3");
  expect(source.files["textures/shared.tga"]).toBe("washoi_textures.pk3");
  expect(source.packages.map((pkg) => pkg.pk3)).toEqual(["washoi_textures.pk3"]);
  expect(await readFile(join(directory, "pk3_index.json"), "utf8")).toBe(before);
  await expect(indexWithMasterBank(directory, JSON.parse(before), "../source.pk3")).rejects.toThrow();
});
