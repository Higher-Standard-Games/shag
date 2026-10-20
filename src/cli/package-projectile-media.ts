import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { shaderBlocks, textureCandidates } from "./map-media";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const normalize = (name: string) => name.replace(/\\/g, "/").toLowerCase();
const stem = (name: string) => normalize(name).replace(/\.(png|tga|jpe?g|ktx|webp)$/i, "");
const options = { date: new Date("1980-01-01T00:00:00Z"), createFolders: false };

/** Extract the four runtime projectile families and their original material definitions. */
export async function projectileMedia(sourceBytes: Uint8Array) {
  const source = await JSZip.loadAsync(sourceBytes);
  const files = new Map<string, Uint8Array>();
  const materials = new Set<string>();
  for (const entry of Object.values(source.files)) {
    if (
      entry.dir ||
      !/^models\/(objects\/projectile|weapon_hits)\/(rlauncher|glauncher|plasmagun|gunblade)\//i.test(entry.name)
    )
      continue;
    const bytes = await entry.async("uint8array");
    files.set(entry.name, bytes);
    if (!entry.name.endsWith(".md3")) continue;
    const b = Buffer.from(bytes);
    if (b.toString("ascii", 0, 4) !== "IDP3") throw new Error(`Invalid MD3: ${entry.name}`);
    let surface = b.readInt32LE(100);
    for (let i = 0; i < b.readInt32LE(84); i++) {
      for (let j = 0; j < b.readInt32LE(surface + 76); j++) {
        const start = surface + b.readInt32LE(surface + 92) + j * 68;
        materials.add(stem(b.toString("utf8", start, start + 64).split("\0")[0]));
      }
      surface += b.readInt32LE(surface + 104);
    }
  }
  for (const required of [
    "rlauncher/rocket_strong",
    "glauncher/grenadestrong",
    "plasmagun/proj_plasmagun",
    "gunblade/proj_gunbladeblast",
  ])
    if (!files.has(`models/objects/projectile/${required}.md3`)) throw new Error(`Missing projectile: ${required}`);
  const blocks = new Map<string, string>();
  for (const entry of Object.values(source.files)) {
    if (!/^scripts\/.*\.shader$/i.test(entry.name)) continue;
    for (const block of shaderBlocks(await entry.async("string"))) blocks.set(block.name, block.source);
  }
  const selected = new Map<string, string>();
  const include = async (name: string): Promise<void> => {
    if (selected.has(name)) return;
    const block = blocks.get(name);
    if (!block) return;
    selected.set(name, block);
    const clean = block.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, " ");
    for (const match of clean.matchAll(/\btemplate\s+([^\s{}]+)/gi)) {
      const template = stem(match[1]);
      if (!blocks.has(template)) throw new Error(`Missing shader template: ${template}`);
      await include(template);
    }
    for (const match of clean.matchAll(/\b(?:models|gfx|env)\/[^\s{}"]+/g)) {
      if (match[0].includes("$")) continue;
      for (const candidate of textureCandidates(match[0])) {
        const entry = source.file(candidate);
        if (entry) files.set(candidate, await entry.async("uint8array"));
      }
    }
  };
  for (const material of materials) await include(material);
  files.set(
    "scripts/washoi_projectiles.shader",
    Uint8Array.from(Buffer.from(`${[...selected.values()].join("\n\n")}\n`)),
  );
  const manifest = {
    sourceSha256: hash(sourceBytes),
    files: [...files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) })),
  };
  const zip = new JSZip();
  for (const [name, bytes] of files) zip.file(name, bytes, options);
  zip.file("models/objects/projectile/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, options);
  return {
    bytes: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }),
    manifest,
  };
}

const sourcePath = process.argv[2] ?? "archive/data0_21pure.pk3";
const output = "assets-source/weapons/projectiles.pk3";
const result = await projectileMedia(Uint8Array.from(await fs.readFile(sourcePath)));
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, Uint8Array.from(result.bytes));
await fs.writeFile("docs/research/media/projectile_package.json", `${JSON.stringify(result.manifest, null, 2)}\n`);
console.log(`${output}: ${result.manifest.files.length} files, ${result.bytes.length} bytes`);
