// Mesh-level versus face-level PVS triangle estimate for world texture groups.
// Run from the root: npx vite-node docs/research/babylon-lite-evidence/face-pvs-estimate.ts -- washoi_dm5
import { BspLoader, findLeafForPoint, isClusterVisible } from "../../../src/engine/loader/bsp/BspLoader";
import { ingestPk3Dir, resolveMapBspViaIndex } from "../../../src/engine/loader/pk3/NodePk3";

const POLYGON = 1;
const PATCH = 2;
const MESH = 3;

async function main(): Promise<void> {
  const maps = process.argv.slice(2).filter((a) => a !== "--");
  const dirs = ["public/data", "public/data/basewsw"];
  for (const dir of dirs) await ingestPk3Dir(dir);
  for (const map of maps) {
    const bytes = await resolveMapBspViaIndex(dirs, map);
    if (!bytes) throw new Error(`missing ${map}`);
    const bsp = BspLoader.load(bytes);
    const world = bsp.models[0];
    const faceClusters = new Map<number, Set<number>>();
    for (const leaf of bsp.leafs) {
      for (let i = 0; i < leaf.numLeafFaces; i++) {
        const face = bsp.leafFaces[leaf.firstLeafFace + i];
        if (face < world.firstFace || face >= world.firstFace + world.numFaces) continue;
        let set = faceClusters.get(face);
        if (!set) faceClusters.set(face, (set = new Set()));
        set.add(leaf.cluster);
      }
    }
    // Texture groups of triangle faces (patches reported separately)
    const groups = new Map<number, number[]>();
    let patchFaces = 0;
    for (let f = world.firstFace; f < world.firstFace + world.numFaces; f++) {
      const face = bsp.faces[f];
      if (face.faceType === PATCH) patchFaces++;
      if (face.faceType !== POLYGON && face.faceType !== MESH) continue;
      if (!groups.has(face.textureIndex)) groups.set(face.textureIndex, []);
      groups.get(face.textureIndex)!.push(f);
    }
    const tris = (f: number) => bsp.faces[f].numMeshVerts / 3;
    const minCluster = (f: number) => Math.min(...(faceClusters.get(f) ?? new Set([-1])));
    for (const faces of groups.values()) faces.sort((a, b) => minCluster(a) - minCluster(b));
    const total = [...groups.values()].flat().reduce((s, f) => s + tris(f), 0);

    const positions = bsp.entities
      .filter((e) => e.classname === "info_player_deathmatch")
      .map((e) => e.properties.origin?.trim().split(/\s+/).map(Number))
      .filter((p): p is number[] => !!p && p.length === 3 && p.every(Number.isFinite));
    const rows = [];
    for (const [x, y, z] of positions) {
      const leaf = findLeafForPoint([x, y, z + 40], bsp.nodes, bsp.leafs, bsp.planes);
      const cluster = leaf?.cluster ?? -1;
      const visible = (f: number) => {
        const set = faceClusters.get(f);
        if (!set || cluster < 0) return true;
        for (const c of set) if (c < 0 || isClusterVisible(bsp.visData, cluster, c)) return true;
        return false;
      };
      let meshTris = 0, faceTris = 0, meshes = 0, ranges = 0;
      for (const faces of groups.values()) {
        const vis = faces.map(visible);
        if (!vis.some(Boolean)) continue;
        meshes++;
        meshTris += faces.reduce((s, f) => s + tris(f), 0);
        let open = false;
        faces.forEach((f, i) => {
          if (vis[i]) { faceTris += tris(f); if (!open) ranges++; open = true; } else open = false;
        });
      }
      rows.push({ cluster, meshes, ranges, meshTris, faceTris });
    }
    const avg = (k: "meshes" | "ranges" | "meshTris" | "faceTris") => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length);
    console.log(JSON.stringify({ map, textureGroups: groups.size, patchFaces, totalTriangleFaceTris: total, samples: rows.length,
      avgMeshes: avg("meshes"), avgRangesSortedByCluster: avg("ranges"), avgMeshLevelTris: avg("meshTris"), avgFaceLevelTris: avg("faceTris"),
      faceVsMesh: +(avg("faceTris") / avg("meshTris")).toFixed(3), rows }));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
