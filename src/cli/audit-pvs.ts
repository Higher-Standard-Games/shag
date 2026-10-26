/** Repeatable BSP/PVS geometry audit. NullEngine counts are not GPU benchmarks.
 * Run: npx vite-node src/cli/audit-pvs.ts -- wdm2 acidwdm2
 */
import { createHash } from "node:crypto";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Scene } from "@babylonjs/core/scene";
import { BspLoader } from "../engine/loader/bsp/BspLoader";
import { BspMeshBuilder, type BspMeshBuildResult } from "../engine/loader/bsp/BspMeshBuilder";
import { MIN_SPATIAL_BATCH_TRIANGLES } from "../engine/loader/bsp/mesh/spatialBatching";
import { PVSCuller } from "../engine/loader/bsp/PVSCuller";
import { ingestPk3Dir, resolveMapBspViaIndex } from "../engine/loader/pk3/NodePk3";
import { Q3ShaderRegistry } from "../engine/loader/shader/Q3ShaderRegistry";
import { runCli } from "./_runCli";

/** Ignore batch order, but preserve triangle winding, all vertex channels and material identity. */
function geometryHash(meshes: AbstractMesh[]): string {
  const triangles: string[] = [];
  for (const mesh of meshes) {
    const channels = [
      [VertexBuffer.PositionKind, 3],
      [VertexBuffer.NormalKind, 3],
      [VertexBuffer.UVKind, 2],
      [VertexBuffer.UV2Kind, 2],
      [VertexBuffer.ColorKind, 4],
    ] as const;
    const data = channels.map(([kind, stride]) => ({ values: mesh.getVerticesData(kind), stride }));
    const vertices = Array.from({ length: mesh.getTotalVertices() }, (_, index) =>
      data.map(({ values, stride }) => values?.slice(index * stride, (index + 1) * stride).join(",") ?? "").join("/"),
    );
    const indices = mesh.getIndices() ?? [];
    const identity = `${mesh.metadata?.textureIndex}/${mesh.metadata?.lightmapIndex}/${mesh.material?.backFaceCulling}`;
    for (let i = 0; i < indices.length; i += 3) {
      triangles.push(`${identity}:${vertices[indices[i]]};${vertices[indices[i + 1]]};${vertices[indices[i + 2]]}`);
    }
  }
  return createHash("sha256").update(triangles.sort().join("\n")).digest("hex");
}

async function main(): Promise<void> {
  const mapNames = process.argv.slice(2).filter((arg) => arg !== "--");
  if (!mapNames.length) mapNames.push("wdm2", "acidwdm2");
  const dirs = ["public/data", "public/data/basewsw"];
  for (const dir of dirs) await ingestPk3Dir(dir);
  await Q3ShaderRegistry.getInstance().loadShaders();
  const engine = new NullEngine();
  try {
    for (const mapName of mapNames) {
      const bytes = await resolveMapBspViaIndex(dirs, mapName);
      if (!bytes) throw new Error(`Map not found through PK3 index: ${mapName}`);
      const bsp = BspLoader.load(bytes);
      const positions = bsp.entities
        .filter((entity) => entity.classname === "info_player_deathmatch")
        .map((entity) => entity.properties.origin?.trim().split(/\s+/).map(Number))
        .filter(
          (position): position is number[] => !!position && position.length === 3 && position.every(Number.isFinite),
        )
        .map(([x, y, z]) => new Vector3(x, z, y));
      if (!positions.length) throw new Error(`No authored deathmatch spawn origins to audit: ${mapName}`);
      let baselineHash = "";
      let baselineTriangles: number[] = [];
      for (const cellSize of [0, 512, 1024, 2048]) {
        const scene = new Scene(engine);
        const culler = new PVSCuller(bsp);
        try {
          const result = BspMeshBuilder.build(bsp, scene, {
            filterTextures: true,
            deluxe: true,
            spatialCellSize: cellSize,
          });
          const meshes = result.worldMesh.getChildMeshes();
          culler.registerFromWorldMesh(result.worldMesh);
          const batches = meshes.map((mesh) => ({
            mesh,
            triangles: mesh.getTotalIndices() / 3,
            clusters: mesh.metadata?.bspPvsClusters as number[],
          }));
          // Hash authored geometry before billboarding modifies position buffers.
          const hash = geometryHash(meshes);
          const samples = positions.map((position) => {
            const stats = culler.update(position);
            return {
              position: position.asArray(),
              cluster: stats.currentCluster,
              visibleMeshes: stats.visibleMeshes,
              visibleTriangles: batches.reduce((sum, batch) => sum + (batch.mesh.isVisible ? batch.triangles : 0), 0),
            };
          });
          if (cellSize === 0) {
            baselineHash = hash;
            baselineTriangles = samples.map((sample) => sample.visibleTriangles);
          }
          if (hash !== baselineHash)
            throw new Error(`Geometry/vertex attributes changed: ${mapName}, cell size ${cellSize}`);
          if (samples.some((sample, i) => sample.visibleTriangles > baselineTriangles[i])) {
            throw new Error(`Partitioning increased PVS-retained triangles: ${mapName}, cell size ${cellSize}`);
          }
          console.log(
            `[PVSAudit] ${JSON.stringify({
              map: mapName,
              cellSize,
              minSplitTriangles: MIN_SPATIAL_BATCH_TRIANGLES,
              meshes: meshes.length,
              vertices: result.stats.totalVertices,
              triangles: result.stats.totalTriangles,
              textureLoadEntries: result.textureGroups?.length,
              geometryHash: hash,
              geometryMatchesBaseline: hash === baselineHash,
              averageVisibleMeshes: samples.reduce((sum, sample) => sum + sample.visibleMeshes, 0) / samples.length,
              averageVisibleTriangles:
                samples.reduce((sum, sample) => sum + sample.visibleTriangles, 0) / samples.length,
              alwaysVisibleMeshes: batches.filter((batch) => batch.clusters.includes(-1)).length,
              autosprites: auditAutospriteUploads(result, positions, culler),
              heaviestBatches: [...batches]
                .sort((a, b) => b.triangles - a.triangles)
                .slice(0, 5)
                .map((batch) => ({
                  texture: batch.mesh.metadata.textureName,
                  lightmap: batch.mesh.metadata.lightmapIndex,
                  triangles: batch.triangles,
                  clusters: batch.clusters.length,
                  // A heavy batch with a null cell was refused a spatial split.
                  // Without this the only symptom is a batch that never shrinks
                  // however small the cells get, which says nothing about why.
                  spatialCell: batch.mesh.metadata.bspSpatialCell ?? null,
                  patch: /_patch/.test(batch.mesh.name),
                })),
              samples,
            })}`,
          );
        } finally {
          culler.dispose();
          scene.dispose();
        }
      }
    }
  } finally {
    engine.dispose();
  }
}

/** Count actual update calls at spawn origins; this is not a GPU/FPS benchmark. */
function auditAutospriteUploads(result: BspMeshBuildResult, positions: Vector3[], culler: PVSCuller) {
  const sprites = result.autospriteMeshes ?? [];
  const eligible = sprites.filter(
    (sprite) => (sprite.mesh.getVerticesData(VertexBuffer.PositionKind)?.length ?? 0) >= 12,
  );
  const samples = positions.map((position, index) => {
    culler.update(position);
    // One upload per mesh, however many sprites it draws
    const expected = new Set(
      eligible
        .filter(
          ({ mesh, center }) =>
            mesh.isVisible &&
            mesh.isEnabled() &&
            mesh.visibility > 0 &&
            Math.hypot(position.x - center[0], position.y - center[1], position.z - center[2]) >= 0.001,
        )
        .map(({ mesh }) => mesh),
    ).size;
    const uploads = BspMeshBuilder.updateAutosprites(result, position);
    const stationaryUploads = BspMeshBuilder.updateAutosprites(result, position);
    // Distinct spawn entities can share an origin; the second is stationary too.
    const expectedUploads = index > 0 && position.equals(positions[index - 1]) ? 0 : expected;
    if (uploads !== expectedUploads || stationaryUploads !== 0) {
      throw new Error(
        `Unexpected autosprite uploads at ${position.asArray()}: ${uploads}/${expectedUploads}, stationary ${stationaryUploads}`,
      );
    }
    return { position: position.asArray(), visibleSpriteMeshes: expected, uploads, stationaryUploads };
  });
  culler.setEnabled(false);
  const offPosition = positions[0].add(new Vector3(0.125, 0, 0));
  const pvsOffUploads = BspMeshBuilder.updateAutosprites(result, offPosition);
  const pvsOffStationaryUploads = BspMeshBuilder.updateAutosprites(result, offPosition);
  const eligibleMeshes = new Set(eligible.map(({ mesh }) => mesh)).size;
  if (pvsOffUploads !== eligibleMeshes || pvsOffStationaryUploads !== 0) {
    throw new Error(`PVS off failed to restore billboard updates: ${pvsOffUploads}/${eligibleMeshes}`);
  }
  culler.setEnabled(true);
  culler.update(offPosition);
  return {
    total: sprites.length,
    eligible: eligible.length,
    meshes: eligibleMeshes,
    averageMovingUploads: samples.reduce((sum, sample) => sum + sample.uploads, 0) / samples.length,
    pvsOffUploads,
    pvsOffStationaryUploads,
    samples,
  };
}

// The full loader import graph can retain Node handles; flush the report before
// ending this one-shot audit, preserving runCli's failure exit code.
void runCli(main).then(() => process.stdout.write("", () => process.exit(process.exitCode ?? 0)));
