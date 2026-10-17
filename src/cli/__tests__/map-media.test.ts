import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { mergeTextureBanks, shaderBlocks, textureCandidates } from "../map-media";

describe("map media extraction", () => {
  const bank = async (image: string, shader: string) =>
    new JSZip().file("textures/a.png", image).file("scripts/map.shader", shader).generateAsync({ type: "uint8array" });
  it("deduplicates shared images and shaders while preserving image bytes", async () => {
    const input = await bank("png bytes", "textures/a { { map textures/a.png } }");
    const merged = await JSZip.loadAsync(await mergeTextureBanks([input, input]));
    expect(await merged.file("textures/a.png")!.async("string")).toBe("png bytes");
    expect(shaderBlocks(await merged.file("scripts/washoi_maps.shader")!.async("string"))).toHaveLength(1);
  });
  it("rejects different shared images or shader definitions", async () => {
    const input = await bank("one", "textures/a { { map textures/a.png } }");
    await expect(
      mergeTextureBanks([input, await bank("two", "textures/a { { map textures/a.png } }")]),
    ).rejects.toThrow("Conflicting asset");
    await expect(mergeTextureBanks([input, await bank("one", "textures/a { { map $whiteimage } }")])).rejects.toThrow(
      "Conflicting shader",
    );
  });
  it("preserves complete conditional shader bodies and ignores comment braces", () => {
    const first = "textures/test/a\n{\n // } comment\n if deluxe { { map textures/test/a } }\n}\n";
    const blocks = shaderBlocks(`/* { ignored } */\n${first}textures/test/b { { map $whiteimage } }`);
    expect(blocks.map((block) => block.name)).toEqual(["textures/test/a", "textures/test/b"]);
    expect(blocks[0].source).toBe(first.trimEnd());
    expect(blocks[1].source).toBe("textures/test/b { { map $whiteimage } }");
  });
  it("rejects truncated shaders instead of publishing partial definitions", () => {
    expect(() => shaderBlocks("textures/broken { { map textures/a }")).toThrow("Unclosed shader");
  });
  it("covers all runtime underscore shader aliases and texture formats", () => {
    const candidates = textureCandidates("Models_Mapobjects_Lights_Boqu_Walllamp1");
    expect(candidates).toContain("models/mapobjects/lights/boqu/walllamp1");
    expect(candidates).toContain("models/mapobjects/lights/boqu_walllamp1.tga");
    expect(candidates).toContain("models/mapobjects_lights_boqu_walllamp1.png");
    expect(textureCandidates("textures/test/a.jpg")).toContain("textures/test/a.ktx");
  });
});
