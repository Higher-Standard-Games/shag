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

/** Units past which sights, sight displays, glass and halos are not drawn: about 4 pixels at 720p. */
export const WEAPON_FINE_DETAIL_DISTANCE = 400;
/** Units past which glow and emit strips are not drawn: they mark the weapon from further off. */
export const WEAPON_STRIP_DETAIL_DISTANCE = 700;

const FINE_PART = /sight_|_display|_glass|_halo/i;
const STRIP_PART = /_emit|_glow/i;

const named = (mesh: AbstractMesh, pattern: RegExp) =>
  pattern.test(mesh.material?.name ?? "") || pattern.test(mesh.name);

/** The distance past which `mesh` stops drawing, or null for a part that always draws. */
export function weaponDetailDistance(mesh: AbstractMesh): number | null {
  if (named(mesh, FINE_PART)) return WEAPON_FINE_DETAIL_DISTANCE;
  if (named(mesh, STRIP_PART)) return WEAPON_STRIP_DETAIL_DISTANCE;
  return null;
}

/** Stop drawing the small parts among `meshes` past their distances. Returns how many it set. */
export function dropDistantWeaponDetail(meshes: readonly AbstractMesh[]): number {
  let count = 0;
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || !mesh.material || mesh.hasLODLevels) continue;
    const distance = weaponDetailDistance(mesh);
    if (distance === null) continue;
    mesh.addLODLevel(distance, null);
    count++;
  }
  return count;
}
