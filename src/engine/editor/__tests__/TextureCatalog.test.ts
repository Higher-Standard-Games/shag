/**
 * The texture catalog on small fixtures, and on the real installed PK3s when
 * public/data is present (it is not in a clean checkout, so those tests skip).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseShaderFile } from "../../loader/shader/Q3ShaderParser";
import { buildTextureCatalog, catalogFolders, parseShaderTags, searchCatalog } from "../TextureCatalog";

const SHADERS = `
textures/blx/blx_light_blue
{
	qer_editorimage textures/lights/bluetrim.tga
	surfaceparm nolightmap
	{
		map textures/lights/bluetrim.tga
	}
}
textures/fx/glass
{
	surfaceparm trans
	{
		map textures/fx/glass_base.tga
		blendFunc blend
	}
}
textures/sky/night
{
	surfaceparm sky
	surfaceparm noimpact
}
textures/broken/nothing
{
	{
		map textures/broken/absent.tga
	}
}
textures/wdm2/wall_olive
{
	{
		map $whiteimage
		rgbGen const ( 0.4 0.5 0.2 )
	}
}
textures/sfx/fog
{
	qer_editorimage textures/sfx/fog_grey.tga
	fogparms ( 0.5 0.5 0.5 ) 512
	surfaceparm fog
}
models/props/crate
{
	{
		map models/props/crate.tga
	}
}
`;

const FILES = [
  "textures/blx/blx_light_blue.jpg",
  "textures/lights/bluetrim.jpg",
  "textures/fx/glass_base.tga",
  "textures/blx/blx_dark.tga",
  "textures/blx/blx_dark_norm.tga",
  "textures/blx/blx_dark_gloss.tga",
  "textures/common/caulk.jpg",
  "textures/blx/blx_grid.ktx",
  "textures/blx/blx_grid.jpg",
  "models/props/crate.tga",
  "scripts/blx.shader",
];

const catalog = () =>
  buildTextureCatalog({
    files: FILES,
    shaders: parseShaderFile(SHADERS),
    tags: parseShaderTags(
      '<root><custom><texture path="textures/common/caulk"><tag>Stock / Compiler</tag></texture></custom></root>',
    ),
  });

describe("texture catalog", () => {
  it("takes a shader's image from the shader, not a same-named file", () => {
    const entry = catalog().find((e) => e.name === "blx/blx_light_blue")!;
    expect(entry).toMatchObject({ hasShader: true, nolightmap: true, missing: false });
    // the .tga reference resolves to the .jpg that ships
    expect(entry.image).toBe("textures/lights/bluetrim.jpg");
  });

  it("lists bare images, drops derived maps, prefers a browser-readable format", () => {
    const names = catalog().map((e) => e.name);
    expect(names).toContain("blx/blx_dark");
    expect(names).not.toContain("blx/blx_dark_norm");
    expect(names).not.toContain("blx/blx_dark_gloss");
    expect(catalog().find((e) => e.name === "blx/blx_grid")?.image).toBe("textures/blx/blx_grid.jpg");
    // shaders outside textures/ are not face materials
    expect(names.some((name) => name.includes("crate"))).toBe(false);
  });

  it("flags transparency, sky, compiler textures and unresolvable shaders, and attaches tags", () => {
    const byName = new Map(catalog().map((e) => [e.name, e]));
    expect(byName.get("fx/glass")).toMatchObject({ transparent: true, image: "textures/fx/glass_base.tga" });
    expect(byName.get("sky/night")).toMatchObject({ sky: true, missing: false, image: null });
    expect(byName.get("broken/nothing")).toMatchObject({ missing: true, image: null });
    expect(byName.get("common/caulk")).toMatchObject({ compiler: true, tags: ["Stock / Compiler"] });
  });

  it("groups folders that differ only in case", () => {
    const entries = buildTextureCatalog({
      files: ["textures/HazelH/wall.tga", "textures/hazelh/floor.tga"],
      shaders: [],
    });
    expect(catalogFolders(entries)).toEqual([{ folder: "hazelh", count: 2 }]);
  });

  it("does not call a shader missing when it draws no image, only when a drawn image is absent", () => {
    const byName = new Map(catalog().map((e) => [e.name, e]));
    // a colour-tinted $whiteimage is a usable material without an image
    expect(byName.get("wdm2/wall_olive")).toMatchObject({ solidColor: true, missing: false, image: null });
    // a fog volume draws no image; its absent editor image only means "no preview"
    expect(byName.get("sfx/fog")).toMatchObject({ fog: true, missing: false, image: null });
  });

  it("counts folders and searches by word, segment start and letters in order", () => {
    expect(catalogFolders(catalog())).toContainEqual({ folder: "blx", count: 3 });
    expect(searchCatalog(catalog(), "dark").map((e) => e.name)).toEqual(["blx/blx_dark"]);
    expect(searchCatalog(catalog(), "bdark")[0].name).toBe("blx/blx_dark");
    expect(searchCatalog(catalog(), "compiler").map((e) => e.name)).toEqual(["common/caulk"]);
    expect(searchCatalog(catalog(), "zzz")).toEqual([]);
    expect(searchCatalog(catalog(), "")).toHaveLength(catalog().length);
  });
});

const DATA = path.join(process.cwd(), "public", "data");
const hasData = fs.existsSync(path.join(DATA, "tex_blx.pk3"));

describe("texture catalog on the installed packages", () => {
  it.skipIf(!hasData)(
    "builds from every PK3 that holds textures, with the gamepack tags",
    async () => {
      const JSZip = (await import("jszip")).default;
      const files: string[] = [];
      const shaderText: string[] = [];
      for (const pk3 of fs.readdirSync(DATA).filter((f) => f.endsWith(".pk3"))) {
        const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(path.join(DATA, pk3))));
        for (const name of Object.keys(zip.files)) {
          if (zip.files[name].dir) continue;
          files.push(name);
          if (/^scripts\/.+\.shader$/i.test(name)) shaderText.push(await zip.files[name].async("string"));
        }
      }
      const tagsXml = fs.readFileSync(path.join(process.cwd(), "editor/gamepacks/washoi.game/shadertags.xml"), "utf8");
      const entries = buildTextureCatalog({
        files,
        shaders: shaderText.flatMap((text) => parseShaderFile(text)),
        tags: parseShaderTags(tagsXml),
      });
      const lightBlue = entries.find((e) => e.name.toLowerCase() === "blx/blx_light_blue");
      expect(lightBlue?.image?.toLowerCase()).toMatch(/^textures\/lights\/bluetrim\./);
      expect(entries.find((e) => e.name === "common/trigger")).toMatchObject({ compiler: true });
      expect(entries.some((e) => e.tags.length > 0)).toBe(true);
      expect(entries.every((e) => !e.name.toLowerCase().startsWith("textures/"))).toBe(true);
      // WO-T0 counted 1,283 base images; shaders and KTX-only images add to that.
      expect(entries.length).toBeGreaterThan(1283);
      console.log(
        `[catalog] ${entries.length} entries, ${catalogFolders(entries).length} folders, ` +
          `${entries.filter((e) => e.hasShader).length} shaders, ${entries.filter((e) => e.missing).length} missing`,
      );
    },
    120_000,
  );
});
