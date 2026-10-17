import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { validModelPath } from "../ModelReference";

type Asset = { path: string; package: string | null; entry: string };
let cached: { key: string; assets: Asset[] } | undefined;

/** Package names are sorted, with later packages overriding earlier ones. Loose models take precedence. */
async function catalog(root: string): Promise<Asset[]> {
  const files = await readdir(root, { withFileTypes: true });
  const packages = files
    .filter((f) => f.isFile() && /\.pk3$/i.test(f.name))
    .map((f) => f.name)
    .sort();
  const loose: string[] = [];
  async function walk(relative: string) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile() && validModelPath(name)) loose.push(name);
    }
  }
  await walk("models");
  const stamps = await Promise.all(
    [...packages, ...loose].map(async (name) => {
      const s = await stat(path.join(root, name));
      return `${name}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    }),
  );
  const key = JSON.stringify([path.resolve(root), stamps]);
  if (cached?.key === key) return cached.assets;
  const found = new Map<string, Asset>();
  for (const pkg of packages) {
    const zip = await JSZip.loadAsync(new Uint8Array(await readFile(path.join(root, pkg))));
    for (const entry of Object.values(zip.files)) {
      if (!entry.dir && validModelPath(entry.name))
        found.set(entry.name.toLowerCase(), { path: entry.name, entry: entry.name, package: pkg });
    }
  }
  for (const name of loose) found.set(name.toLowerCase(), { path: name, entry: name, package: null });
  const assets = [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
  cached = { key, assets };
  return assets;
}

/** Raw asset mesh/frame envelope, before entity scale/yaw. No browser renderer is needed. */
export function modelBounds(bytes: Uint8Array, filename: string) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  const add = (p: number[]) => {
    if (p.length !== 3 || !p.every(Number.isFinite)) throw new Error("Non-finite model coordinates");
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
    count++;
  };
  if (/\.(ase|obj)$/i.test(filename)) {
    const ase = /\.ase$/i.test(filename);
    const expression = ase ? /^\s*\*MESH_VERTEX\s+\d+\s+(\S+)\s+(\S+)\s+(\S+)/gm : /^\s*v\s+(\S+)\s+(\S+)\s+(\S+)/gm;
    for (const match of new TextDecoder().decode(bytes).matchAll(expression)) add(match.slice(1).map(Number));
  } else if (/\.md3$/i.test(filename)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 108 || view.getInt32(0, true) !== 0x33504449 || view.getInt32(4, true) !== 15)
      throw new Error("Invalid MD3 header");
    const frames = view.getInt32(76, true);
    const offset = view.getInt32(92, true);
    if (frames < 1 || offset < 108 || offset + frames * 56 > bytes.length) throw new Error("Invalid MD3 frame range");
    for (let i = 0; i < frames; i++)
      for (const delta of [0, 12]) add([0, 4, 8].map((axis) => view.getFloat32(offset + i * 56 + delta + axis, true)));
  } else return null;
  return count
    ? { min, max, dimensions: max.map((n, i) => n - min[i]), space: "Asset coordinates, before placement transforms" }
    : null;
}

export async function searchModelCatalog(
  root: string,
  query: { search?: string; offset?: number; limit?: number; includeBounds?: boolean } = {},
) {
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 50;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Model offset must be nonnegative; limit must be 1..500.");
  const terms = query.search?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const found = (await catalog(root)).filter((asset) => terms.every((term) => asset.path.toLowerCase().includes(term)));
  const archives = new Map<string, JSZip>();
  const models = [];
  for (const asset of found.slice(offset, offset + limit)) {
    let bounds: ReturnType<typeof modelBounds> = null;
    let boundsIssue: string | undefined;
    if (query.includeBounds) {
      try {
        let bytes: Uint8Array;
        if (asset.package) {
          let zip = archives.get(asset.package);
          if (!zip) {
            zip = await JSZip.loadAsync(new Uint8Array(await readFile(path.join(root, asset.package))));
            archives.set(asset.package, zip);
          }
          const entry = zip.file(asset.entry);
          if (!entry) throw new Error("Asset changed during discovery; retry the query");
          bytes = await entry.async("uint8array");
        } else bytes = new Uint8Array(await readFile(path.join(root, asset.entry)));
        bounds = modelBounds(bytes, asset.path);
        if (!bounds) boundsIssue = "Bounds unavailable: only ASE/OBJ mesh vertices and MD3 frame bounds are inspected.";
      } catch (error) {
        boundsIssue = error instanceof Error ? error.message : String(error);
      }
    }
    models.push({
      path: asset.path,
      package: asset.package,
      format: path.extname(asset.path).slice(1).toLowerCase(),
      bounds,
      ...(boundsIssue ? { boundsIssue } : {}),
    });
  }
  return {
    ok: true,
    total: found.length,
    offset,
    nextOffset: Math.min(offset + limit, found.length),
    models,
    placement: {
      classname: "misc_model",
      model: "Use a returned path as keys.model",
      modelscale: "Positive uniform scale; default 1",
      angle: "Yaw in degrees; default 0",
      collision:
        "Compiler-generated collision depends on the model/material and compiler settings. Inspect and trace the compiled BSP; bounds are not collision geometry.",
    },
  };
}
