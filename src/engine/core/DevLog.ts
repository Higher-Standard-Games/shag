import { Cvar } from "./Cvar";

/** Whether repeating development lines print: `developer 1`. */
export function devLogEnabled(): boolean {
  return Cvar.getBool("developer");
}

/**
 * A console line for lines that repeat in play: every death, ragdoll, weapon
 * change, projectile, model load or respawn. Printed only with `developer 1`,
 * so a normal session's console shows what happened once (connecting, the
 * map, the match phase) and warnings, not a line per frag. Lines that are
 * costly to build should check {@link devLogEnabled} first.
 *
 * Production builds strip console.log either way; this is for development.
 */
export function devLog(...args: unknown[]): void {
  if (devLogEnabled()) console.log(...args);
}
