/**
 * FreeflyCollisionCommand - Freefly camera collision control and debugging
 */

import { Command, CommandDef } from '../Command';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

// Visualization state
let collisionVizMeshes: Mesh[] = [];
let clipBrushVizMeshes: Mesh[] = [];

export class FreeflyCollisionCommand extends Command {
  readonly definition: CommandDef = {
    name: 'freefly_collision',
    description: 'Freefly camera collision control',
    usage: 'freefly_collision <0|1|mode|test|draw|clear|clipviz|clipdump|cliptrace>',
  };

  async execute(args: string[]): Promise<string> {
    const { FreeflyController } = await import('../../camera/controllers/FreeflyController');
    const { getCollisionManager } = await import('../../physics');
    const { CameraSystem } = await import('../../camera/CameraSystem');
    
    const cm = getCollisionManager();
    const isInit = cm.isInitialized();
    const stats = isInit ? cm.getStats() : null;
    const planeCount = (stats?.backendStats as any)?.collisionPlanes || 0;

    const value = args[0]?.toLowerCase();

    // No argument - show current state
    if (value === undefined) {
      const enabled = FreeflyController.isCollisionEnabled();
      const mode = FreeflyController.getCollisionMode();
      const status = mode === 'native' 
        ? 'Mode: native (Babylon mesh collision)'
        : (isInit 
          ? `Mode: bsp, Backend: ${cm.getBackendType()} (${planeCount} planes)` 
          : 'Mode: bsp, WARNING: Collision not initialized (load a map first)');
      return `freefly_collision = ${enabled ? '1' : '0'}\n${status}`;
    }

    // Mode subcommand
    if (value === 'mode') {
      const newMode = args[1]?.toLowerCase();
      if (newMode === 'native' || newMode === 'bsp') {
        FreeflyController.setCollisionMode(newMode);
        return `Collision mode set to: ${newMode}`;
      }
      const currentMode = FreeflyController.getCollisionMode();
      return `Current mode: ${currentMode}\nUsage: freefly_collision mode <native|bsp>\n  native - Uses Babylon's built-in mesh collision\n  bsp - Uses BSP brush tracing`;
    }

    // Test subcommand
    if (value === 'test') {
      const cameraSystem = CameraSystem.getInstance();
      const camera = cameraSystem.getCamera();
      if (!camera) return 'No camera available';
      
      const pos = camera.position;
      const forward = camera.getDirection(new Vector3(0, 0, 1));
      const end = pos.add(forward.scale(100));
      
      const result = cm.trace(pos as never, end as never, { debug: true });
      
      return [
        `=== Collision Test from Camera ===`,
        `Instance: ${cm.getInstanceId()}`,
        `Backend: ${cm.getBackendType()}`,
        `Camera: (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})`,
        `Forward 100 units: fraction=${result.fraction.toFixed(3)}`,
        result.fraction < 1.0 ? `HIT at ${(result.fraction * 100).toFixed(1)} units` : 'NO HIT',
        result.normal ? `Normal: (${result.normal.x.toFixed(2)}, ${result.normal.y.toFixed(2)}, ${result.normal.z.toFixed(2)})` : '',
      ].filter(Boolean).join('\n');
    }

    // Clear subcommand
    if (value === 'clear') {
      const disposed = collisionVizMeshes.length + clipBrushVizMeshes.length;
      for (const m of collisionVizMeshes) {
        try { m.dispose(false, true); } catch { /* ignore */ }
      }
      collisionVizMeshes = [];
      for (const m of clipBrushVizMeshes) {
        try { m.dispose(false, true); } catch { /* ignore */ }
      }
      clipBrushVizMeshes = [];
      return `Collision viz cleared (${disposed} meshes)`;
    }

    // Draw subcommand
    if (value === 'draw') {
      const cameraSystem = CameraSystem.getInstance();
      const camera = cameraSystem.getCamera();
      const scene = camera?.getScene?.();
      if (!camera || !scene) return 'No active camera/scene available';
      if (!cm.isInitialized()) return 'Collision not initialized (load a map first)';

      const dist = Number(args[1] ?? '200');
      const normalLen = Number(args[2] ?? '32');
      const radius = Number(args[3] ?? '16');
      const height = Number(args[4] ?? '56');
      if (!Number.isFinite(dist) || dist <= 0) {
        return 'Usage: freefly_collision draw [dist] [normalLen] [radius] [height]';
      }

      const start = camera.position.clone();
      const forward = camera.getDirection(new Vector3(0, 0, 1));
      const end = start.add(forward.scale(dist));

      const trace = cm.trace(start as never, end as never, {
        radius: Number.isFinite(radius) ? radius : 16,
        height: Number.isFinite(height) ? height : 56,
      });
      const hit = trace.fraction < 1.0;
      const hitPos = hit ? Vector3.Lerp(start, end, trace.fraction) : end;

      // Trace segment
      const segColor = hit ? Color3.Yellow() : Color3.Green();
      const traceLine = MeshBuilder.CreateLines('collision_trace', { points: [start, hitPos], updatable: false }, scene);
      traceLine.color = segColor;
      traceLine.isPickable = false;
      collisionVizMeshes.push(traceLine);

      // Remaining segment
      if (hit) {
        const restLine = MeshBuilder.CreateLines('collision_trace_rest', { points: [hitPos, end], updatable: false }, scene);
        restLine.color = Color3.Red();
        restLine.isPickable = false;
        collisionVizMeshes.push(restLine);
      }

      // Hit normal
      if (hit && trace.normal && Number.isFinite(normalLen) && normalLen > 0) {
        const n = trace.normal as any;
        const normal = new Vector3(n.x, n.y, n.z);
        const normalEnd = hitPos.add(normal.scale(normalLen));
        const normalLine = MeshBuilder.CreateLines('collision_normal', { points: [hitPos, normalEnd], updatable: false }, scene);
        normalLine.color = new Color3(0, 1, 1);
        normalLine.isPickable = false;
        collisionVizMeshes.push(normalLine);
      }

      return [
        '=== Collision Viz ===',
        `Start: (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)})`,
        `End:   (${end.x.toFixed(1)}, ${end.y.toFixed(1)}, ${end.z.toFixed(1)})`,
        `Hull: radius=${Number.isFinite(radius) ? radius : 16}, height=${Number.isFinite(height) ? height : 56}`,
        `Hit: ${hit ? 'YES' : 'NO'} frac=${trace.fraction.toFixed(4)} startSolid=${trace.startSolid}`,
        hit && trace.normal
          ? `Normal: (${(trace.normal as any).x.toFixed(3)}, ${(trace.normal as any).y.toFixed(3)}, ${(trace.normal as any).z.toFixed(3)})`
          : '',
        'Use: freefly_collision clear',
      ].filter(Boolean).join('\n');
    }

    // Cliptrace subcommand
    if (value === 'cliptrace') {
      const cameraSystem = CameraSystem.getInstance();
      const camera = cameraSystem.getCamera();
      if (!camera) return 'No camera available';
      if (!cm.isInitialized()) return 'Collision not initialized (load a map first)';

      const dist = Number(args[1] ?? '200');
      const radius = Number(args[2] ?? '16');
      const height = Number(args[3] ?? '56');
      const debug = (args[4] ?? '').toLowerCase() === 'debug';
      if (!Number.isFinite(dist) || dist <= 0) {
        return 'Usage: freefly_collision cliptrace [dist] [radius] [height] [debug]';
      }

      const ellipsoidOffset = (camera as any).ellipsoidOffset ? (camera as any).ellipsoidOffset : Vector3.Zero();
      const start = camera.position.add(ellipsoidOffset);
      const forward = camera.getDirection(new Vector3(0, 0, 1));
      const end = start.add(forward.scale(dist));

      const trace = cm.trace(start as never, end as never, {
        radius: Number.isFinite(radius) ? radius : 16,
        height: Number.isFinite(height) ? height : 56,
        clipTexturesOnly: true,
        contentMask: 0x1 | 0x10000,
        debug,
      } as any);

      const hit = trace.fraction < 1.0;
      const hitBrushIndex = (trace as any).hitBrushIndex;
      const hitTextureName = (trace as any).hitTextureName;
      return [
        '=== Clip Trace ===',
        `Start: (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)})`,
        `End:   (${end.x.toFixed(1)}, ${end.y.toFixed(1)}, ${end.z.toFixed(1)})`,
        `Hull: radius=${Number.isFinite(radius) ? radius : 16}, height=${Number.isFinite(height) ? height : 56}`,
        `Hit: ${hit ? 'YES' : 'NO'} frac=${trace.fraction.toFixed(4)} startSolid=${trace.startSolid}`,
        hit ? `Brush: ${hitBrushIndex} Tex: ${hitTextureName}` : '',
      ].filter(Boolean).join('\n');
    }

    // Clipdump subcommand
    if (value === 'clipdump') {
      return this.handleClipdump(args);
    }

    // Clipviz subcommand
    if (value === 'clipviz') {
      return this.handleClipviz(args);
    }

    // Parse value as boolean
    const enabled = value === '1' || value === 'true' || value === 'on';
    FreeflyController.setCollisionEnabled(enabled);
    (FreeflyController as any)._loggedState = false;

    const backendInfo = isInit 
      ? `Backend: ${cm.getBackendType()} (${planeCount} planes), Instance: ${cm.getInstanceId()}` 
      : 'WARNING: Collision not initialized (load a map first)';

    return `freefly_collision = ${enabled ? '1' : '0'}\n${backendInfo}`;
  }

  private async handleClipdump(args: string[]): Promise<string> {
    const { MapLoader } = await import('../../loader/map/MapLoader');
    const { FreeflyController } = await import('../../camera/controllers/FreeflyController');
    
    const mapLoader = MapLoader.getInstance();
    const bsp = mapLoader.getCurrentBsp();
    if (!bsp) return 'No BSP loaded (load a map first)';

    const mode = args[1]?.toLowerCase();
    let brushIndex: number | null = null;
    if (mode === 'last') {
      brushIndex = FreeflyController.getLastClipHitBrushIndex();
      if (brushIndex === null) return 'No last clip hit recorded yet';
    } else if (mode === 'brush') {
      const idx = Number(args[2]);
      if (!Number.isFinite(idx)) return 'Usage: freefly_collision clipdump brush <index>';
      brushIndex = idx;
    } else if (args[1] !== undefined) {
      const idx = Number(args[1]);
      if (!Number.isFinite(idx)) return 'Usage: freefly_collision clipdump <index> | last | brush <index>';
      brushIndex = idx;
    } else {
      return 'Usage: freefly_collision clipdump <index> | last | brush <index>';
    }

    const brush = bsp.brushes[brushIndex];
    if (!brush) return `Brush ${brushIndex} not found`;
    const tex = bsp.textures[brush.shaderIndex];
    const texName = tex?.name ?? '<none>';
    const contentFlags = tex?.contentFlags ?? 0;

    const lines: string[] = [];
    lines.push('=== Clip Brush Dump ===');
    lines.push(`Brush: ${brushIndex}`);
    lines.push(`Texture: ${texName}`);
    lines.push(`contentFlags: 0x${contentFlags.toString(16)}`);
    lines.push(`firstSide: ${brush.firstSide} numSides: ${brush.numSides}`);
    lines.push(`Format: ${bsp.header.isFBSP ? 'FBSP' : 'IBSP'}`);

    if (brush.numSides < 4) {
      lines.push('WARNING: numSides < 4 => not a closed convex volume');
    }

    const dupPlanes = new Map<number, number>();
    for (let si = 0; si < brush.numSides; si++) {
      const side = bsp.brushSides[brush.firstSide + si];
      if (!side) {
        lines.push(`Side ${si}: <missing>`);
        continue;
      }
      dupPlanes.set(side.planeIndex, (dupPlanes.get(side.planeIndex) ?? 0) + 1);
      const plane = bsp.planes[side.planeIndex];
      if (!plane) {
        lines.push(`Side ${si}: planeIndex=${side.planeIndex} <missing plane>`);
        continue;
      }
      const n = plane.normal;
      lines.push(`Side ${si}: plane=${side.planeIndex} n=(${n[0].toFixed(4)}, ${n[1].toFixed(4)}, ${n[2].toFixed(4)}) dist=${plane.dist.toFixed(4)}`);
    }

    const dupList = Array.from(dupPlanes.entries()).filter(([, c]) => c > 1);
    if (dupList.length > 0) {
      lines.push('Duplicate plane indices:');
      for (const [pi, c] of dupList) {
        lines.push(`  plane ${pi}: ${c}x`);
      }
    }

    return lines.join('\n');
  }

  private async handleClipviz(args: string[]): Promise<string> {
    const { CameraSystem } = await import('../../camera/CameraSystem');
    const { MapLoader } = await import('../../loader/map/MapLoader');
    const { FreeflyController } = await import('../../camera/controllers/FreeflyController');
    
    const cameraSystem = CameraSystem.getInstance();
    const camera = cameraSystem.getCamera();
    const scene = camera?.getScene?.() as Scene | undefined;
    if (!camera || !scene) return 'No active camera/scene available';

    const rawMode = args[1]?.toLowerCase();
    const numericModeVal = Number(args[1]);
    const numericMode = args[1] !== undefined && Number.isFinite(numericModeVal) && rawMode !== 'off' && rawMode !== 'clear' && rawMode !== 'last' && rawMode !== 'brush';
    const mode = numericMode ? undefined : rawMode;
    
    if (mode === 'off' || mode === 'clear') {
      const disposed = clipBrushVizMeshes.length;
      for (const m of clipBrushVizMeshes) {
        try { m.dispose(false, true); } catch { /* ignore */ }
      }
      clipBrushVizMeshes = [];
      return `Clip viz cleared (${disposed} meshes)`;
    }

    const mapLoader = MapLoader.getInstance();
    const bsp = mapLoader.getCurrentBsp();
    if (!bsp) return 'No BSP loaded (load a map first)';

    // Clear existing viz
    for (const m of clipBrushVizMeshes) {
      try { m.dispose(false, true); } catch { /* ignore */ }
    }
    clipBrushVizMeshes = [];

    const isFBSP = bsp.header.isFBSP;
    let targetBrushIndex: number | null = null;
    if (mode === 'last') {
      targetBrushIndex = FreeflyController.getLastClipHitBrushIndex();
      if (targetBrushIndex === null) return 'No last clip hit recorded yet';
    } else if (mode === 'brush') {
      const idx = Number(args[2]);
      if (!Number.isFinite(idx)) return 'Usage: freefly_collision clipviz brush <index>';
      targetBrushIndex = idx;
    }

    const max = targetBrushIndex !== null ? 1 : (numericMode ? numericModeVal : Infinity);
    let created = 0;
    let skipped = 0;

    // World bounds
    const root = bsp.nodes[0];
    const mins = root?.mins ?? [0, 0, 0];
    const maxs = root?.maxs ?? [0, 0, 0];
    const worldMin = new Vector3(mins[0], mins[2], mins[1]);
    const worldMax = new Vector3(maxs[0], maxs[2], maxs[1]);
    const oobMargin = 1024;
    const oobMin = worldMin.subtract(new Vector3(oobMargin, oobMargin, oobMargin));
    const oobMax = worldMax.add(new Vector3(oobMargin, oobMargin, oobMargin));

    for (let bi = 0; bi < bsp.brushes.length; bi++) {
      if (created >= max) break;
      if (targetBrushIndex !== null && bi !== targetBrushIndex) continue;

      const brush = bsp.brushes[bi];
      const tex = bsp.textures[brush.shaderIndex];
      const texName = tex?.name?.toLowerCase() || '';
      const isFullclip = texName === 'textures/common/fullclip' || texName === 'common/fullclip';
      const isPlayerclip = texName === 'textures/common/playerclip' || texName === 'common/playerclip';
      if (!isFullclip && !isPlayerclip) continue;

      const meshData = this.buildClipBrushMesh(bsp, brush, isFBSP, oobMin, oobMax);
      if (!meshData) {
        skipped++;
        continue;
      }

      const mesh = new Mesh(`clipviz_${isFullclip ? 'fullclip' : 'playerclip'}_${bi}`, scene);
      const vd = new VertexData();
      vd.positions = meshData.positions;
      vd.indices = meshData.indices;
      vd.normals = meshData.normals;
      vd.applyToMesh(mesh);

      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.renderingGroupId = 3;

      const mat = new StandardMaterial(`clipviz_mat_${bi}`, scene);
      const c = isFullclip ? new Color3(1, 0.2, 0.2) : new Color3(0.2, 1, 0.2);
      mat.diffuseColor = c;
      mat.emissiveColor = c;
      mat.alpha = 0.22;
      mat.wireframe = true;
      mat.backFaceCulling = false;
      mesh.material = mat;

      clipBrushVizMeshes.push(mesh);
      created++;
    }

    return [
      '=== Clip Brush Viz ===',
      targetBrushIndex !== null ? `Brush: ${targetBrushIndex}` : '',
      `Meshes: ${created} (skipped: ${skipped})`,
      'Colors: fullclip=red, playerclip=green',
      'Use: freefly_collision clipviz clear',
    ].filter(Boolean).join('\n');
  }

  private buildClipBrushMesh(bsp: any, brush: any, flipInside: boolean, oobMin: Vector3, oobMax: Vector3): { positions: number[]; indices: number[]; normals: number[] } | null {
    type PlaneEq = { n: Vector3; d: number; dist: number };
    const planes: PlaneEq[] = [];

    for (let si = 0; si < brush.numSides; si++) {
      const side = bsp.brushSides[brush.firstSide + si];
      if (!side) continue;
      const plane = bsp.planes[side.planeIndex];
      if (!plane) continue;

      const nx = plane.normal[0];
      const ny = plane.normal[1];
      const nz = plane.normal[2];
      const dist = plane.dist;

      const n = new Vector3(nx, nz, ny);
      const d = -dist;
      planes.push({ n, d, dist });
    }

    if (planes.length < 4) return null;

    const epsInside = 0.1;
    const epsDedupSq = 0.25;

    const intersect3 = (p1: PlaneEq, p2: PlaneEq, p3: PlaneEq): Vector3 | null => {
      const det = Vector3.Dot(p1.n, Vector3.Cross(p2.n, p3.n));
      if (Math.abs(det) < 0.000001) return null;
      const c23 = Vector3.Cross(p2.n, p3.n).scale(-p1.d);
      const c31 = Vector3.Cross(p3.n, p1.n).scale(-p2.d);
      const c12 = Vector3.Cross(p1.n, p2.n).scale(-p3.d);
      return c23.add(c31).add(c12).scale(1 / det);
    };

    const outsideMetric = (pl: PlaneEq, p: Vector3): number => {
      const q3Dist = Vector3.Dot(pl.n, p) - pl.dist;
      return flipInside ? -q3Dist : q3Dist;
    };

    const isInside = (p: Vector3): boolean => {
      for (const pl of planes) {
        if (outsideMetric(pl, p) > epsInside) return false;
      }
      return true;
    };

    const isWithinWorld = (p: Vector3): boolean => {
      return p.x >= oobMin.x && p.x <= oobMax.x &&
             p.y >= oobMin.y && p.y <= oobMax.y &&
             p.z >= oobMin.z && p.z <= oobMax.z;
    };

    const uniqueVerts: Vector3[] = [];
    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        for (let k = j + 1; k < planes.length; k++) {
          const p = intersect3(planes[i], planes[j], planes[k]);
          if (!p) continue;
          if (!isInside(p)) continue;
          if (!uniqueVerts.some(v => Vector3.DistanceSquared(v, p) < epsDedupSq)) {
            uniqueVerts.push(p);
          }
        }
      }
    }

    if (uniqueVerts.length < 4) return null;
    if (!uniqueVerts.every(isWithinWorld)) return null;

    const centroid = uniqueVerts.reduce((a, b) => a.add(b), Vector3.Zero()).scale(1 / uniqueVerts.length);

    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    let indexOffset = 0;

    for (const pl of planes) {
      const faceVerts: Vector3[] = [];
      for (const v of uniqueVerts) {
        if (Math.abs(Vector3.Dot(pl.n, v) - pl.dist) < 0.2) {
          faceVerts.push(v);
        }
      }

      if (faceVerts.length < 3) continue;

      const faceCenter = faceVerts.reduce((a, b) => a.add(b), Vector3.Zero()).scale(1 / faceVerts.length);
      const along = centroid.add(pl.n);
      const faceN = outsideMetric(pl, along) > outsideMetric(pl, centroid) ? pl.n : pl.n.scale(-1);

      let tangent = Vector3.Cross(faceN, Vector3.Up());
      if (tangent.lengthSquared() < 0.001) {
        tangent = Vector3.Cross(faceN, Vector3.Right());
      }
      tangent.normalize();
      const bitangent = Vector3.Cross(faceN, tangent);

      faceVerts.sort((a, b) => {
        const va = a.subtract(faceCenter);
        const vb = b.subtract(faceCenter);
        const angleA = Math.atan2(Vector3.Dot(va, bitangent), Vector3.Dot(va, tangent));
        const angleB = Math.atan2(Vector3.Dot(vb, bitangent), Vector3.Dot(vb, tangent));
        return angleA - angleB;
      });

      for (let fj = 1; fj < faceVerts.length - 1; fj++) {
        const v0 = faceVerts[0];
        const v1 = faceVerts[fj];
        const v2 = faceVerts[fj + 1];

        positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
        normals.push(faceN.x, faceN.y, faceN.z, faceN.x, faceN.y, faceN.z, faceN.x, faceN.y, faceN.z);
        indices.push(indexOffset, indexOffset + 1, indexOffset + 2);
        indexOffset += 3;
      }
    }

    if (indices.length === 0) return null;
    return { positions, indices, normals };
  }
}

export default FreeflyCollisionCommand;
