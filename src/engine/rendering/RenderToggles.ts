import { Cvar } from "../core/Cvar";

/** Frame-cost switches that are on unless turned off; RenderVars defines them. */
export type RenderToggle = "r_dynamiclight" | "r_marks" | "r_gibs" | "r_teleport_ghost";

/**
 * Whether a frame-cost switch is on. A switch nobody registered (tests,
 * headless tools) counts as on, as its default does.
 */
export function renderToggle(name: RenderToggle): boolean {
  return Cvar.get(name) === undefined || Cvar.getBool(name);
}
