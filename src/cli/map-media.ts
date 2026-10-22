import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { BspLoader } from "../engine/loader/bsp/BspLoader";
import { PK3Index } from "../engine/loader/pk3/PK3Index";
import { parseShaderFile } from "../engine/loader/shader/Q3ShaderParser";
import type { Q3Shader } from "../engine/loader/shader/Q3ShaderTypes";
import { shaderSourceBlocks } from "../engine/loader/shader/ShaderSourceBlocks";
import { readPackagePolicy, sharedPackageForPath } from "./pk3-package-policy";

const hash = (bytes: ArrayLike<number>) => createHash("sha256").update(Uint8Array.from(bytes)).digest("hex");
const normalize = (name: string) => name.replace(/\\/g, "/").replace(/^\//, "").toLowerCase();
const stem = (name: string) => normalize(name).replace(/\.(tga|png|jpe?g|ktx|webp)$/i, "");
const extensions = [".tga", ".png", ".jpg", ".jpeg", ".ktx", ".webp"];
const companion = ["_norm", "_normal", "_bump", "_gloss", "_spec", "_glow"];

/** Keep original stage syntax and conditionals instead of reserializing parser objects. */
export function shaderBlocks(source: string): { name: string; source: string }[] {
  return shaderSourceBlocks(source).map((block) => ({ ...block, name: stem(block.name) }));
}

export function textureCandidates(reference: string): string[] {
  const name = normalize(reference);
  const names = [name];
  if (name.includes("_") && !name.includes("/")) {
    const parts = name.split("_");
    for (let count = parts.length - 1; count >= 1; count--)
      names.push(`${parts.slice(0, count).join("/")}/${parts.slice(count).join("_")}`);
    names.push(parts.join("/"));
    if (parts.length >= 3) names.push(`${parts[0]}/${parts[1]}/${parts.slice(2).join("_")}`);
    if (parts.length >= 4) names.push(`${parts[0]}/${parts[1]}/${parts[2]}/${parts.slice(3).join("_")}`);
  }
  const candidates = names.flatMap((item) => {
    const prefixed = [item];
    if (!/^(textures|models)\//.test(item)) prefixed.push(`textures/${item}`);
    return prefixed.flatMap((value) => [value, ...extensions.map((ext) => stem(value) + ext)]);
  });
  return [...new Set(candidates)];
}

interface Index {
  files: Record<string, string>;
  shaders: Record<string, string>;
  packages: { pk3: string; path: string }[];
}
interface Asset {
  name: string;
  owner: string;
  bytes: number;
  sha256: string;
  reasons: string[];
}

/** Read-only source bank; output construction never overwrites source packages. */
export class MediaBank {
  readonly zips = new Map<string, JSZip>();
  readonly shaderSources = new Map<string, { source: string; file: string; owner: string; parsed: Q3Shader }>();
  readonly templates = new Map<string, string>();
  readonly unparsedShaders = new Set<string>();
  constructor(
    readonly directory: string,
    readonly index: Index,
  ) {}
  async zip(owner: string): Promise<JSZip> {
    let zip = this.zips.get(owner);
    if (!zip) {
      const item = this.index.packages.find((item) => item.pk3 === owner);
      if (!item) throw new Error(`Unindexed package: ${owner}`);
      zip = await JSZip.loadAsync(new Uint8Array(await fs.readFile(path.join(this.directory, item.path))));
      this.zips.set(owner, zip);
    }
    return zip;
  }
  async read(name: string): Promise<Buffer> {
    const owner = this.index.files[normalize(name)];
    if (!owner) throw new Error(`Missing indexed asset: ${name}`);
    const zip = await this.zip(owner);
    const file = Object.values(zip.files).find((file) => normalize(file.name) === normalize(name) && !file.dir);
    if (!file) throw new Error(`Missing archive entry: ${owner}:${name}`);
    return file.async("nodebuffer");
  }
  async loadShaders(): Promise<void> {
    for (const pkg of this.index.packages) {
      if (
        !Object.entries(this.index.files).some(
          ([name, owner]) => owner === pkg.pk3 && /^scripts\/.*\.shader$/i.test(name),
        )
      )
        continue;
      const zip = await this.zip(pkg.pk3);
      for (const file of Object.values(zip.files).filter((file) => /^scripts\/.*\.shader$/i.test(file.name))) {
        if (this.index.files[normalize(file.name)] !== pkg.pk3) continue;
        const source = await file.async("string");
        const parsedShaders = new Map(parseShaderFile(source).map((shader) => [stem(shader.name), shader]));
        for (const block of shaderBlocks(source)) {
          if (block.name.endsWith("_template") || block.name.startsWith("template_")) {
            this.templates.set(block.name, block.source);
            continue;
          }
          if (this.index.shaders[block.name] !== pkg.pk3) continue;
          const parsed = parsedShaders.get(block.name);
          if (!parsed) {
            this.unparsedShaders.add(block.name);
            continue;
          }
          this.shaderSources.set(block.name, { ...block, file: file.name, owner: pkg.pk3, parsed });
        }
      }
    }
  }
  shader(name: string) {
    for (const candidate of textureCandidates(name)) {
      if (this.unparsedShaders.has(stem(candidate))) throw new Error(`Selected shader cannot be parsed: ${candidate}`);
      const shader = this.shaderSources.get(stem(candidate));
      if (shader) return [stem(candidate), shader] as const;
    }
    return null;
  }
}

export async function packageMap(bank: MediaBank, map: string, outputDirectory: string, auditOnly = false) {
  const policy = readPackagePolicy();
  const sharedDependencies = new Set<string>();
  if (!/^[a-z0-9_]+$/.test(map)) throw new Error(`Invalid map name: ${map}`);
  const bspPath = `maps/${map}.bsp`;
  const bspBytes = await bank.read(bspPath);
  const bsp = BspLoader.load(
    bspBytes.buffer.slice(bspBytes.byteOffset, bspBytes.byteOffset + bspBytes.length) as ArrayBuffer,
  );
  const assets = new Map<string, Asset>();
  const renderNames = new Set(bsp.faces.map((face) => bsp.textures[face.textureIndex]?.name).filter(Boolean));
  const shaders = new Map<string, NonNullable<ReturnType<MediaBank["shader"]>>[1]>();
  const missing = new Set<string>();
  const queue: string[] = [];
  const add = async (name: string, reason: string): Promise<void> => {
    name = normalize(name);
    if (name.split("/").includes("..")) throw new Error(`Invalid asset path: ${name}`);
    if (!bank.index.files[name]) return;
    if (assets.has(name)) {
      const asset = assets.get(name)!;
      if (!asset.reasons.includes(reason)) asset.reasons.push(reason);
      return;
    }
    const bytes = await bank.read(name);
    const sharedPackage = sharedPackageForPath(name, policy);
    if (sharedPackage) sharedDependencies.add(sharedPackage);
    assets.set(name, {
      name,
      owner: sharedPackage ?? bank.index.files[name],
      bytes: bytes.length,
      sha256: hash(bytes),
      reasons: [reason],
    });
    if (/\.(md3|skin|gltf|glb|ase)$/i.test(name)) queue.push(name);
  };
  const texture = async (reference: string, reason: string): Promise<boolean> => {
    if (!reference || /^(\$|\*|-|none$)/i.test(reference)) return true;
    let found = false;
    for (const candidate of textureCandidates(reference)) {
      if (!bank.index.files[candidate]) continue;
      found = true;
      await add(candidate, reason);
      if (extensions.some((ext) => candidate.endsWith(ext))) {
        for (const suffix of companion)
          for (const ext of extensions) await add(stem(candidate) + suffix + ext, `${reason} companion`);
      }
    }
    return found;
  };
  const material = async (name: string, reason: string): Promise<void> => {
    const hit = bank.shader(name);
    if (!hit) {
      if (!(await texture(name, reason))) missing.add(name);
      return;
    }
    const [key, entry] = hit;
    if (shaders.has(key)) return;
    shaders.set(key, entry);
    const shader = entry.parsed;
    // Preserve both branches, even if a particular graphics profile does not use one.
    const stages = [
      ...shader.stages,
      ...(shader.unconditionalStages ?? []),
      ...(shader.conditionalBlocks ?? []).flatMap((b) => b.stages),
    ];
    for (const stage of stages) {
      const refs = [stage.map, ...(stage.animMap?.frames ?? []), ...(stage.material?.rawTokens ?? [])];
      for (const ref of refs) await texture(ref, `shader ${key}`);
      if (stage.cubeMap) {
        await texture(stage.cubeMap, `cubemap ${key}`);
        for (const suffix of ["px", "nx", "py", "ny", "pz", "nz", "rt", "lf", "up", "dn", "ft", "bk"])
          await texture(`${stage.cubeMap}_${suffix}`, `cubemap ${key}`);
      }
    }
    await texture(shader.editorImage ?? "", `editor fallback ${key}`);
    for (const box of [shader.skyParms?.farbox, shader.skyParms?.nearbox]) {
      if (!box || box === "-") continue;
      for (const suffix of ["rt", "bk", "lf", "ft", "up", "dn"]) await texture(`${box}_${suffix}`, `sky ${key}`);
    }
    for (const side of shader.skyParms?.sides ?? []) await texture(side, `sky side ${key}`);
    await texture(name, `implicit ${key}`);
  };
  for (const item of bsp.textures) await material(item.name, "BSP material");
  for (const entity of bsp.entities) {
    for (const [key, value] of Object.entries(entity.properties)) {
      if (
        /^(model|model2|debris1|debris2|noise|sound|music|skin|shader|targetshadername|targetshadernewname)$/i.test(key)
      ) {
        for (const ref of value.split(/\s+/)) {
          if (ref.startsWith("*")) continue;
          if (/shader/i.test(key)) await material(ref, `entity ${entity.classname}.${key}`);
          else if (bank.index.files[normalize(ref)]) await add(ref, `entity ${entity.classname}.${key}`);
          else if (/\.(md3|glb|gltf|ogg|wav)$/i.test(ref)) missing.add(ref);
        }
      }
    }
  }
  for (const [name] of Object.entries(bank.index.files)) {
    if (
      name.startsWith(`levelshots/${map}`) ||
      name === `maps/${map}.arena` ||
      name === `scripts/${map}.arena` ||
      name.startsWith(`minimaps/${map}.`) ||
      name.startsWith(`navigation/${map}.`)
    )
      await add(name, "map metadata");
  }
  for (const name of queue) {
    const bytes = await bank.read(name);
    if (name.endsWith(".md3")) {
      if (bytes.toString("ascii", 0, 4) !== "IDP3") throw new Error(`Bad MD3: ${name}`);
      let surface = bytes.readInt32LE(100);
      for (let i = 0; i < bytes.readInt32LE(84); i++) {
        for (let j = 0; j < bytes.readInt32LE(surface + 76); j++) {
          const start = surface + bytes.readInt32LE(surface + 92) + j * 68;
          await material(bytes.toString("utf8", start, start + 64).split("\0")[0], `model ${name}`);
        }
        surface += bytes.readInt32LE(surface + 104);
      }
    } else if (name.endsWith(".skin")) {
      for (const line of bytes.toString("utf8").split(/\r?\n/)) {
        const ref = line.split(",")[1]?.trim();
        if (ref) await material(ref, `skin ${name}`);
      }
    } else if (name.endsWith(".ase")) {
      for (const match of bytes.toString("utf8").matchAll(/\*BITMAP\s+"([^"]+)"/gi))
        await texture(match[1], `ASE ${name}`);
    } else {
      const json = name.endsWith(".glb")
        ? bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12))
        : bytes.toString("utf8");
      const gltf = JSON.parse(json) as { images?: { uri?: string }[]; buffers?: { uri?: string }[] };
      for (const item of [...(gltf.images ?? []), ...(gltf.buffers ?? [])]) {
        if (!item.uri || item.uri.startsWith("data:")) continue;
        const uri = path.posix.normalize(path.posix.join(path.posix.dirname(name), item.uri));
        await add(uri, `glTF ${name}`);
      }
    }
  }
  const mapZip = new JSZip(),
    texZip = new JSZip();
  const options = { date: new Date("1980-01-01T00:00:00Z"), createFolders: false };
  mapZip.file(bspPath, new Uint8Array(bspBytes), options);
  for (const asset of [...assets.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (sharedPackageForPath(asset.name, policy)) continue;
    const mapAsset = /^(levelshots|minimaps|navigation|maps)\//.test(asset.name) || asset.name.endsWith(".arena");
    (mapAsset ? mapZip : texZip).file(asset.name, new Uint8Array(await bank.read(asset.name)), options);
  }
  const neededTemplates = new Map<string, string>();
  const includeTemplates = (source: string) => {
    const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, " ");
    for (const match of clean.matchAll(/\btemplate\s+([^\s{}]+)/gi)) {
      const name = match[1].toLowerCase();
      if (neededTemplates.has(name)) continue;
      const body = bank.templates.get(name) ?? bank.shaderSources.get(name)?.source;
      if (!body) throw new Error(`Unresolved shader template: ${name}`);
      neededTemplates.set(name, body);
      includeTemplates(body);
    }
  };
  for (const shader of shaders.values()) includeTemplates(shader.source);
  const script = [
    ...neededTemplates.values(),
    ...[...shaders].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry.source),
  ].join("\n\n");
  texZip.file(`scripts/zz_map_${map}.shader`, `${script}\n`, options);
  // Keep source-file comments and attribution without registering unused shaders.
  for (const file of new Set([...shaders.values()].map((entry) => entry.file)))
    texZip.file(`media-sources/${map}/${file}.txt`, new Uint8Array(await bank.read(file)), options);
  // Rebuilding from curated banks must retain the original attribution chain.
  for (const owner of new Set(
    [...assets.values()]
      .map((entry) => bank.index.files[entry.name])
      .concat([...shaders.values()].map((entry) => entry.owner)),
  )) {
    if (!owner.startsWith("tex_") && owner !== "textures.pk3" && owner !== "washoi_textures.pk3") continue;
    const source = await bank.zip(owner);
    for (const file of Object.values(source.files)) {
      if (!file.dir && file.name.startsWith("media-sources/"))
        texZip.file(file.name, new Uint8Array(await file.async("nodebuffer")), options);
      if (!file.dir && file.name.startsWith("media-manifests/"))
        texZip.file(
          `media-sources/inputs/${owner}/${file.name}`,
          new Uint8Array(await file.async("nodebuffer")),
          options,
        );
    }
  }
  const manifest = {
    map,
    sharedDependencies: [...sharedDependencies].sort().map((packageName) => ({
      package: packageName,
      dynamic: policy.sharedTexturePackages[packageName].dynamic,
      texturePrefixes: policy.sharedTexturePackages[packageName].prefixes,
    })),
    bsp: { owner: bank.index.files[bspPath], sha256: hash(bspBytes) },
    assets: [...assets.values()],
    shaders: [...shaders].map(([name, entry]) => ({
      name,
      owner: entry.owner,
      source: entry.file,
      sha256: hash(Buffer.from(entry.source)),
    })),
    unresolved: [...missing].sort(),
    unresolvedRenderMaterials: [...missing].filter((name) => renderNames.has(name)).sort(),
  };
  if (auditOnly) return { ...manifest, outputs: [] };
  texZip.file(`media-manifests/${map}.json`, `${JSON.stringify(manifest, null, 2)}\n`, options);
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputs = [];
  for (const [filename, zip] of [
    [`map_${map}.pk3`, mapZip],
    [`tex_${map}.pk3`, texZip],
  ] as const) {
    const destination = path.resolve(outputDirectory, filename);
    if (bank.index.packages.some((pkg) => path.resolve(bank.directory, pkg.path) === destination))
      throw new Error(`Output would overwrite an input: ${destination}`);
    const bytes = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    await fs.writeFile(destination, new Uint8Array(bytes));
    outputs.push({ filename, bytes: bytes.length, sha256: hash(bytes) });
  }
  return { ...manifest, outputs };
}

/** Merge reviewed map banks without silently changing any shared file or shader. */
export async function mergeTextureBanks(inputs: Uint8Array[]): Promise<Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const shaders = new Map<string, string>();
  for (const bytes of inputs) {
    const source = await JSZip.loadAsync(bytes, { checkCRC32: true });
    for (const file of Object.values(source.files)) {
      if (file.dir) continue;
      const name = file.name.toLowerCase();
      if (name.startsWith("/") || name.split("/").includes("..")) throw new Error(`Unsafe bank path: ${name}`);
      const data = new Uint8Array(await file.async("nodebuffer"));
      if (name.startsWith("scripts/") && name.endsWith(".shader")) {
        for (const block of shaderBlocks(Buffer.from(data).toString("utf8"))) {
          const key = block.name.toLowerCase();
          if (shaders.has(key) && shaders.get(key) !== block.source) throw new Error(`Conflicting shader: ${key}`);
          shaders.set(key, block.source);
        }
      } else {
        if (files.has(name) && hash(files.get(name)!) !== hash(data)) throw new Error(`Conflicting asset: ${name}`);
        files.set(name, data);
      }
    }
  }
  const output = new JSZip();
  const options = { date: new Date("1980-01-01T00:00:00Z"), createFolders: false };
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) output.file(name, bytes, options);
  output.file(
    "scripts/washoi_maps.shader",
    `${[...shaders]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, source]) => source)
      .join("\n\n")}\n`,
    options,
  );
  const result = await output.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  const verified = await JSZip.loadAsync(result, { checkCRC32: true });
  for (const [name, bytes] of files) {
    if (hash(await verified.file(name)!.async("nodebuffer")) !== hash(bytes))
      throw new Error(`Merged hash mismatch: ${name}`);
  }
  return result;
}

export async function indexWithMasterBank(directory: string, index: Index, master: string): Promise<Index> {
  if (!/^[a-z0-9][a-z0-9_.-]*\.pk3$/i.test(master)) throw new Error("Invalid --master-package basename");
  // Source preparation must not publish the development bank or use stale per-map copies.
  const packages = index.packages.filter((pkg) => !pkg.pk3.toLowerCase().startsWith("tex_") && pkg.pk3 !== master);
  packages.push({ pk3: master, path: master });
  const sourceIndex = PK3Index.getInstance();
  sourceIndex.clear();
  try {
    for (const pkg of packages.sort((a, b) => a.pk3.localeCompare(b.pk3))) {
      const bytes = await fs.readFile(path.join(directory, pkg.path));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      if (!(await sourceIndex.indexPK3ArrayBuffer(pkg.pk3, buffer, pkg.path)))
        throw new Error(`Cannot index map media source package: ${pkg.pk3}`);
    }
    return sourceIndex.exportSnapshot();
  } finally {
    sourceIndex.clear();
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const value = (flag: string, fallback: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
  const directory = path.resolve(value("--data-dir", "public/data"));
  const output = path.resolve(value("--output-dir", ".cache/map-media"));
  let index = JSON.parse(await fs.readFile(path.join(directory, "pk3_index.json"), "utf8")) as Index;
  if (args.includes("--master-package"))
    index = await indexWithMasterBank(directory, index, value("--master-package", ""));
  const maps = value("--maps", "washoi_dm2,washoi_dm5,washoi_dm11").split(",");
  const bank = new MediaBank(directory, index);
  await bank.loadShaders();
  const report = [];
  for (const map of maps) {
    const item = await packageMap(bank, map, output, args.includes("--audit-only"));
    report.push(item);
    console.log(
      `[map-media] ${map}: ${item.assets.length} assets, ${item.shaders.length} shaders, ${item.unresolved.length} unresolved`,
    );
  }
  if (args.includes("--combined") && !args.includes("--audit-only")) {
    const destination = path.join(output, "washoi_textures.pk3");
    if (index.packages.some((pkg) => path.resolve(directory, pkg.path) === destination))
      throw new Error(`Output would overwrite an input: ${destination}`);
    const bytes = await mergeTextureBanks(
      await Promise.all(
        maps.map(async (map) => new Uint8Array(await fs.readFile(path.join(output, `tex_${map}.pk3`)))),
      ),
    );
    await fs.writeFile(destination, bytes);
    console.log(`[map-media] washoi_textures.pk3: ${bytes.length} bytes, ${hash(bytes)}`);
  }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
