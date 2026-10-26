import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Isolated source experiment; never edits or replaces the gameplay renderer. */
export function prepareMatrixFreeVoltaic(root, reference) {
  if (!/^[a-f0-9]{7,40}$/.test(reference ?? "")) throw new Error("Matrix-free experiment requires a commit hash");
  const read = (file) => execFileSync("git", ["-C", root, "show", `${reference}:src/engine/weapon/voltaic/${file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
  const replace = (source, before, after, expected = 1) => {
    if (source.split(before).length - 1 !== expected) throw new Error(`Prototype source changed: ${before}`);
    return source.replaceAll(before, after);
  };
  let renderer = read("VoltaicEffectRenderer.ts");
  let shader = read("VoltaicShaderMaterial.ts");
  renderer = replace(renderer, "  private readonly matrices: Float32Array;\n", "");
  renderer = replace(renderer, "    this.matrices = new Float32Array(capacity * 16);\n", "");
  renderer = replace(renderer, `    for (let instance = 0; instance < capacity; instance++) {
      const offset = instance * 16;
      this.matrices[offset] = 1;
      this.matrices[offset + 5] = 1;
      this.matrices[offset + 10] = 1;
      this.matrices[offset + 15] = 1;
    }
`, "");
  renderer = replace(renderer, '    mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, true);\n', "");
  renderer = replace(renderer, ".thinInstanceCount = count;", ".forcedInstanceCount = count;", 2);
  renderer = replace(renderer, "    this.beamMesh.material = this.beamMaterial;", `    // Analytic effects retain always-active selection and template bounds.
    // Forced draws are classified as thin instances, but have no matrix array.
    this.beamMesh.doNotSyncBoundingInfo = true;
    this.impactMesh.doNotSyncBoundingInfo = true;
    this.beamMesh.material = this.beamMaterial;`);
  renderer = replace(renderer, `    // Thin-instance shaders require THIN_INSTANCES, not merely INSTANCES. A
    // temporary count makes Babylon compile the exact live batch variant.`, `    // A temporary forced count compiles the exact live custom-attribute variant.`);
  shader = replace(shader, "#include<instancesDeclaration>", `#ifdef WORLD_BATCH
uniform mat4 world;
#else
#include<instancesDeclaration>
#endif`, 2);
  shader = replace(shader, "#include<instancesVertex>", `#ifdef WORLD_BATCH
mat4 finalWorld = world;
#else
#include<instancesVertex>
#endif`, 2);
  const token = createHash("sha256").update(renderer).update(shader).digest("hex").slice(0, 20);
  const remap = (source) => source.replaceAll('"./', '"/src/engine/weapon/voltaic/').replaceAll('"../../', '"/src/engine/');
  renderer = remap(renderer).replace('"/src/engine/weapon/voltaic/VoltaicShaderMaterial"', `"/.cache/renderer-groundwork/MatrixFreeShader-${token}.ts"`);
  const cache = path.join(root, ".cache/renderer-groundwork");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, `MatrixFreeVoltaic-${token}.ts`), renderer);
  fs.writeFileSync(path.join(cache, `MatrixFreeShader-${token}.ts`), remap(shader));
  return { token, reference, route: "isolated matrix-free prototype" };
}
