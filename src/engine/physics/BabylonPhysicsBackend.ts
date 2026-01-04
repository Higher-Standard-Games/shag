/**
 * BabylonPhysicsBackend - Uses Babylon.js ray casting against rendered meshes
 * 
 * This backend leverages Babylon's built-in ray casting to detect collisions
 * against the actual rendered BSP geometry.
 */

import { Vector3, Scene, Ray, Mesh, AbstractMesh } from '@babylonjs/core';
import type { BspFile } from '../loader/bsp/BspLoader';
import {
  CollisionBackend,
  CollisionBackendType,
  TraceResult,
  TraceOptions,
  CollisionStats,
  createDefaultTraceResult,
  Contents,
} from './CollisionBackend';

export class BabylonPhysicsBackend implements CollisionBackend {
  readonly type: CollisionBackendType = 'babylon';
  readonly name = 'Babylon.js Ray Casting';

  private scene: Scene | null = null;
  private collisionMeshes: AbstractMesh[] = [];
  private stats: CollisionStats = {
    traceCount: 0,
    hitCount: 0,
    avgTraceTimeMs: 0,
    backendStats: { meshCount: 0 },
  };

  async init(_bsp: BspFile, scene?: Scene): Promise<void> {
    if (!scene) {
      console.warn('[BabylonPhysicsBackend] No scene provided, collision will not work');
      return;
    }

    this.scene = scene;
    this.collisionMeshes = [];

    // Find all BSP meshes in the scene
    for (const mesh of scene.meshes) {
      // Look for meshes that are part of BSP geometry
      if (mesh.name.startsWith('bsp_') || 
          mesh.name.includes('polygon') || 
          mesh.name.includes('patch') ||
          mesh.name.includes('mesh')) {
        if (mesh instanceof Mesh) {
          mesh.isPickable = true;
          this.collisionMeshes.push(mesh);
        }
      }
    }

    // If no BSP-specific meshes found, use all pickable meshes
    if (this.collisionMeshes.length === 0) {
      this.collisionMeshes = scene.meshes.filter(m => m.isPickable && m instanceof Mesh);
    }

    this.stats.backendStats.meshCount = this.collisionMeshes.length;
    console.log(`[BabylonPhysicsBackend] Using ${this.collisionMeshes.length} meshes for collision`);
  }

  trace(start: Vector3, end: Vector3, options?: TraceOptions): TraceResult {
    const startTime = performance.now();
    this.stats.traceCount++;

    const result = createDefaultTraceResult(start, end);
    const debug = options?.debug ?? false;

    if (!this.scene) {
      if (debug) console.log('[BabylonPhysics] No scene available');
      return result;
    }

    // Create ray from start to end
    const direction = end.subtract(start);
    const length = direction.length();
    
    if (length < 0.001) {
      return result;
    }

    const normalizedDir = direction.normalize();
    const ray = new Ray(start, normalizedDir, length);

    if (debug) {
      console.log(`[BabylonPhysics] Ray: (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)}) dir=(${normalizedDir.x.toFixed(2)}, ${normalizedDir.y.toFixed(2)}, ${normalizedDir.z.toFixed(2)}) len=${length.toFixed(1)}`);
    }

    // Pick against scene meshes
    const pickResult = this.scene.pickWithRay(ray, (mesh) => {
      return this.collisionMeshes.includes(mesh);
    });

    if (pickResult?.hit && pickResult.pickedPoint && pickResult.distance !== undefined) {
      result.fraction = pickResult.distance / length;
      result.endPos = pickResult.pickedPoint.clone();
      result.contents = Contents.SOLID;
      
      if (pickResult.getNormal) {
        const normal = pickResult.getNormal(true);
        if (normal) {
          result.normal = normal;
        }
      }

      this.stats.hitCount++;

      if (debug) {
        console.log(`[BabylonPhysics] HIT at fraction ${result.fraction.toFixed(4)}, mesh: ${pickResult.pickedMesh?.name}`);
      }
    } else if (debug) {
      console.log(`[BabylonPhysics] No hit`);
    }

    const elapsed = performance.now() - startTime;
    this.stats.avgTraceTimeMs = (this.stats.avgTraceTimeMs * (this.stats.traceCount - 1) + elapsed) / this.stats.traceCount;

    return result;
  }

  pointContents(point: Vector3): number {
    // Cast rays in 6 directions to check if inside geometry
    const directions = [
      new Vector3(1, 0, 0),
      new Vector3(-1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, -1, 0),
      new Vector3(0, 0, 1),
      new Vector3(0, 0, -1),
    ];

    let hitCount = 0;
    for (const dir of directions) {
      const result = this.trace(point, point.add(dir.scale(1)), { debug: false });
      if (result.fraction < 1.0) {
        hitCount++;
      }
    }

    // If hits in multiple directions, probably inside solid
    return hitCount >= 3 ? Contents.SOLID : 0;
  }

  isOnGround(point: Vector3, options?: TraceOptions): boolean {
    const groundCheck = this.trace(
      point,
      point.add(new Vector3(0, -2, 0)),
      options
    );
    return groundCheck.fraction < 1.0;
  }

  findGround(point: Vector3, maxDistance = 500): { position: Vector3; normal: Vector3 } | null {
    const result = this.trace(
      point,
      point.add(new Vector3(0, -maxDistance, 0))
    );

    if (result.fraction < 1.0 && result.normal) {
      return {
        position: result.endPos,
        normal: result.normal,
      };
    }

    return null;
  }

  getStats(): CollisionStats {
    return { ...this.stats };
  }

  dispose(): void {
    this.collisionMeshes = [];
    this.scene = null;
  }
}
