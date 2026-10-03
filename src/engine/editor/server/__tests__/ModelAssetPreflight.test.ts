import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { checkModelAssets, modelPathsInMap } from "../ModelAssetPreflight";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const map = (model: string) => `{
"classname" "worldspawn"
{
brushDef
{
}
}
}
// "classname" "misc_model"
{
"model" "${model}"
"classname" "misc_model"
}
`;

describe("misc_model asset preflight", () => {
  it("reads point entity paths and ignores nested brush data and comments", () => {
    expect(modelPathsInMap(map("models/props/crate.md3"))).toEqual(["models/props/crate.md3"]);
  });

  it("accepts loose assets and assets mounted from PK3s", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-model-assets-"));
    roots.push(root);
    await mkdir(path.join(root, "models", "props"), { recursive: true });
    await writeFile(path.join(root, "models", "props", "crate.glb"), "model");
    const zip = new JSZip();
    zip.file("models/props/arch.md3", "model");
    await writeFile(path.join(root, "props.pk3"), Uint8Array.from(await zip.generateAsync({ type: "nodebuffer" })));
    await expect(checkModelAssets(map("models/props/crate.glb"), root)).resolves.toBeUndefined();
    await expect(checkModelAssets(map("models/props/arch.md3"), root)).resolves.toBeUndefined();
  });

  it("rejects missing and unsafe model paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shagged-model-assets-"));
    roots.push(root);
    await expect(checkModelAssets(map("models/props/missing.md3"), root)).rejects.toThrow("asset missing");
    await expect(checkModelAssets(map("models/../secret.md3"), root)).rejects.toThrow("Invalid misc_model");
    await expect(checkModelAssets(map(""), root)).rejects.toThrow("Invalid misc_model");
  });
});
