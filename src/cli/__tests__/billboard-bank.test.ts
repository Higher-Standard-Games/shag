import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { type BspFile, BspLoader } from "../../engine/loader/bsp/BspLoader";
import { MediaBank, packageMap } from "../map-media";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

it("packages billboard art/overlays without changing the master or including DM2 branding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shag-billboard-bank-"));
  directories.push(dir);
  const recipe = JSON.parse(await readFile("config/billboard-package.json", "utf8"));
  const zip = new JSZip();
  for (const entry of recipe.files)
    if (!entry.destination) zip.file(`textures/billboard/${entry.name}.${entry.extension}`, "original");
  for (const name of recipe.retainedOverlays) zip.file(name, "overlay");
  zip.file("textures/billboard/terebi_01.jpg", "frame");
  zip.file("textures/boqu/logo.png", "permanent");
  const master = join(dir, "master.pk3"),
    out = join(dir, "tex_billboard.pk3");
  const original = await zip.generateAsync({ type: "uint8array" });
  await writeFile(master, original);
  execFileSync(process.execPath, ["scripts/package-billboard-bank.mjs", "--package", master, "--output", out], {
    stdio: "pipe",
  });
  expect(new Uint8Array(await readFile(master))).toEqual(original);
  const bank = await JSZip.loadAsync(new Uint8Array(await readFile(out)), { checkCRC32: true });
  expect(bank.file("textures/boqu/logo.png")).toBeNull();
  expect(await bank.file("textures/billboard/terebi_01.jpg")!.async("string")).toBe("frame");
  expect(await bank.file("textures/billboard/code.jpg")!.async("string")).toBe("overlay");
  expect(new Uint8Array(await bank.file("textures/billboard/bigbill1.png")!.async("uint8array"))).toEqual(
    new Uint8Array(await readFile("assets/billboards/bigbill1.png")),
  );
});

it("omits shared billboard pixels from a map bank and declares their shared dependency", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shag-map-billboards-"));
  directories.push(dir);
  const name = "textures/billboard/bigbill1.png";
  const zip = new JSZip().file("maps/test.bsp", "bsp").file(name, "ad");
  await writeFile(join(dir, "washoi_textures.pk3"), await zip.generateAsync({ type: "uint8array" }));
  vi.spyOn(BspLoader, "load").mockReturnValue({
    textures: [{ name: "textures/billboard/bigbill1" }],
    faces: [],
    entities: [],
  } as unknown as BspFile);
  const bank = new MediaBank(dir, {
    files: { "maps/test.bsp": "washoi_textures.pk3", [name]: "washoi_textures.pk3" },
    shaders: {},
    packages: [{ pk3: "washoi_textures.pk3", path: "washoi_textures.pk3" }],
  });
  const report = await packageMap(bank, "test", join(dir, "out"));
  expect(report.sharedDependencies).toEqual([
    { package: "tex_billboard.pk3", dynamic: true, texturePrefixes: ["textures/billboard/"] },
  ]);
  const result = await JSZip.loadAsync(new Uint8Array(await readFile(join(dir, "out/tex_test.pk3"))), {
    checkCRC32: true,
  });
  expect(result.file(name)).toBeNull();
  expect(report.assets.find((asset) => asset.name === name)?.owner).toBe("tex_billboard.pk3");
});
