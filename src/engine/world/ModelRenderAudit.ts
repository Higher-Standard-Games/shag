/**
 * Render diagnostics: for a model assembled around a leader mesh, shared by the
 * map pickup and dropped-weapon audits, and for the world meshes MapLoader
 * checks once the loading screen has gone. Each field answers part of "why is
 * this enabled mesh not on screen": culled, not ready and waiting on what,
 * skinned somewhere other than its transform says, or on a layer the camera skips.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { isTextureReleased } from "../loader/model/ModelSourceCache";

const n = (value: number) => (Number.isFinite(value) ? value.toFixed(0) : String(value));

/** What an enabled mesh that is not ready is waiting on. */
function notReadyReason(mesh: AbstractMesh): string {
  const material = mesh.material;
  if (!material) return `${mesh.name}:no-material`;
  const error = mesh.subMeshes?.find((subMesh) => subMesh.effect)?.effect?.getCompilationError();
  if (error) return `${material.name}:shader-error(${error.replace(/\s+/g, " ").slice(0, 120)})`;
  const textures = material.getActiveTextures().filter((texture) => isTextureReleased(texture) || !texture.isReady());
  if (textures.length > 0) {
    const names = textures.map((texture) => `${texture.name || "?"}${isTextureReleased(texture) ? "[released]" : ""}`);
    return `${material.name}:textures(${names.join("|")})`;
  }
  return `${material.name}:material`;
}

/**
 * Meshes that would be drawn but are not ready to be, each named with what it
 * waits on. Hidden, disabled and empty meshes are left out: nothing is drawn for them.
 *
 * Readiness is kept per render pass, and each camera has its own. Between
 * frames the engine is left on the last camera drawn, which in play is the
 * weapon view: it never draws the world, so every world mesh read as not
 * ready there. Pass the camera that draws `meshes` to ask in its pass.
 */
export function describeUnreadyMeshes(meshes: readonly AbstractMesh[], camera?: Camera | null): string[] {
  const engine = meshes[0]?.getEngine();
  const previous = engine?.currentRenderPassId;
  if (engine && camera) engine.currentRenderPassId = camera.renderPassId;
  try {
    const unready: string[] = [];
    for (const mesh of meshes) {
      if (mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible || mesh.getTotalVertices() === 0) continue;
      if (!mesh.isReady(true)) unready.push(`${mesh.name}(${notReadyReason(mesh)})`);
    }
    return unready;
  } finally {
    if (engine && previous !== undefined) engine.currentRenderPassId = previous;
  }
}

/** World-space bounds of the leader's vertices after skinning: where the geometry actually is. */
function skinnedBounds(leader: AbstractMesh): string {
  const positions = leader.getPositionData(true, true);
  if (!positions || positions.length < 3) return "none";
  const world = leader.computeWorldMatrix(true);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const point = new Vector3();
  let nonFinite = 0;
  for (let i = 0; i < positions.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(positions[i], positions[i + 1], positions[i + 2], world, point);
    if (!Number.isFinite(point.x + point.y + point.z)) {
      nonFinite++;
      continue;
    }
    min.minimizeInPlace(point);
    max.maximizeInPlace(point);
  }
  if (nonFinite * 3 === positions.length) return `all-${nonFinite}-non-finite`;
  const centre = min.add(max).scale(0.5);
  const size = max.subtract(min);
  return (
    `@${n(centre.x)},${n(centre.y)},${n(centre.z)} size=${n(size.x)}x${n(size.y)}x${n(size.z)}` +
    (nonFinite > 0 ? ` nonFinite=${nonFinite}` : "")
  );
}

export function describeModelRender(leader: AbstractMesh, scene: Scene): string {
  const meshes = [leader, ...leader.getChildMeshes(false)].filter((mesh) => mesh.getTotalVertices() > 0);
  const activeMeshes = scene.getActiveMeshes();
  const camera = scene.activeCamera;
  let negative = 0;
  let positive = 0;
  let zero = 0;
  let active = 0;
  let inFrustum = 0;
  let ready = 0;
  let culled = 0;
  let enabled = 0;
  let visible = 0;
  let lights = 0;
  const notReady: string[] = [];
  for (const mesh of meshes) {
    const determinant = mesh.computeWorldMatrix(true).determinant();
    if (determinant < -1e-6) negative++;
    else if (determinant > 1e-6) positive++;
    else zero++;
    if (activeMeshes.contains(mesh)) active++;
    if (camera?.isInFrustum(mesh)) inFrustum++;
    if (mesh.isReady(true)) ready++;
    else notReady.push(notReadyReason(mesh));
    if (mesh.material?.backFaceCulling) culled++;
    if (mesh.isEnabled()) enabled++;
    if (mesh.isVisible && mesh.visibility > 0) visible++;
    lights = Math.max(lights, mesh.lightSources.length);
  }
  const count = meshes.length;
  const body = leader.physicsBody;
  return (
    `meshes=${count},det(-/+0)=${negative}/${positive}/${zero},active=${active}/${count},` +
    `inFrustum=${inFrustum}/${count},enabled=${enabled}/${count},visible=${visible}/${count},` +
    `ready=${ready}/${count},backCull=${culled}/${count},lights<=${lights},` +
    `layer=0x${leader.layerMask.toString(16)},group=${leader.renderingGroupId},` +
    `skinned=${skinnedBounds(leader)},physics=${body ? `${n(body.getLinearVelocity().length())}u/s` : "none"}` +
    (notReady.length > 0 ? `,notReady=[${notReady.join("; ")}]` : "")
  );
}
