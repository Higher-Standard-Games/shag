/**
 * Small weapon parts drop out at range.
 *
 * A third-person or dropped weapon draws one call per part: body, sights and
 * their displays, glow and emit strips, glass, halos and barrels. Past a few
 * hundred units the small parts are a few pixels, so they stop drawing there
 * (a Babylon level of detail with no mesh); the body and barrels stay.
 */

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

/** Units from the camera past which small weapon parts are not drawn. */
export const WEAPON_DETAIL_DISTANCE = 700;

/** Sights, sight displays, emit and glow strips, glass and halos, by material or mesh name. */
const SMALL_PART = /sight_|_display|_emit|_glow|_glass|_halo/i;

export function isSmallWeaponPart(mesh: AbstractMesh): boolean {
  return SMALL_PART.test(mesh.material?.name ?? "") || SMALL_PART.test(mesh.name);
}

/** Stop drawing the small parts among `meshes` beyond `distance`. Returns how many it set. */
export function dropDistantWeaponDetail(meshes: readonly AbstractMesh[], distance = WEAPON_DETAIL_DISTANCE): number {
  let count = 0;
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || !mesh.material || !isSmallWeaponPart(mesh)) continue;
    if (mesh.hasLODLevels) continue;
    mesh.addLODLevel(distance, null);
    count++;
  }
  return count;
}
