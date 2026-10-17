import { SPAWN_CLASSNAMES, TEAM_SPAWN_CLASSNAMES } from "../../../shared/bsp/SpawnPointTable";
import { type BspFile, BspLoader } from "../../loader/bsp/BspLoader";
import { resolveMapBspViaIndex } from "../../loader/pk3/NodePk3";

export interface PaletteQuery {
  search?: string;
  offset?: number;
  limit?: number;
}

/** Compiled geometry bounds include scenery, sky and clips; they are not playable bounds. */
export function summarizeInstalledMap(bsp: BspFile, mapName: string, query: PaletteQuery = {}) {
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 100;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Palette offset must be nonnegative; limit must be 1..500.");
  const counts = new Map<string, number>();
  for (const face of bsp.faces) {
    const name = bsp.textures[face.textureIndex]?.name.replace(/^textures\//i, "");
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const terms = query.search?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const palette = [...counts]
    .map(([name, faces]) => ({ name, faces }))
    .filter(({ name }) => terms.every((term) => name.toLowerCase().includes(term)))
    .sort((a, b) => b.faces - a.faces || a.name.localeCompare(b.name));
  const classes = new Map<string, number>();
  for (const entity of bsp.entities) classes.set(entity.classname, (classes.get(entity.classname) ?? 0) + 1);
  const world = bsp.models[0];
  return {
    ok: true,
    mapName,
    coordinates: "Quake Z-up",
    format: bsp.header.isFBSP ? "FBSP" : "IBSP",
    worldBounds: world ? { min: world.mins, max: world.maxs } : null,
    boundsMeaning: "Compiled world envelope, including scenery and clips; not a measurement of playable space.",
    counts: {
      faces: bsp.faces.length,
      brushes: bsp.brushes.length,
      models: bsp.models.length,
      entities: bsp.entities.length,
    },
    entityClasses: [...classes]
      .map(([classname, count]) => ({ classname, count }))
      .sort((a, b) => a.classname.localeCompare(b.classname)),
    spawns: bsp.entities
      .filter(
        (entity) =>
          SPAWN_CLASSNAMES.includes(entity.classname) || Object.keys(TEAM_SPAWN_CLASSNAMES).includes(entity.classname),
      )
      .map((entity) => ({ classname: entity.classname, ...entity.properties })),
    palette: {
      total: palette.length,
      offset,
      nextOffset: Math.min(offset + limit, palette.length),
      materials: palette.slice(offset, offset + limit),
    },
  };
}

export async function inspectInstalledMap(mediaRoot: string, mapName: string, query: PaletteQuery = {}) {
  if (!/^[a-z][a-z0-9_]{0,47}$/i.test(mapName)) throw new Error("Invalid installed map name.");
  const bytes = await resolveMapBspViaIndex([mediaRoot], mapName);
  if (!bytes) throw new Error(`Installed map not found in the PK3 index: ${mapName}`);
  return summarizeInstalledMap(BspLoader.load(bytes), mapName, query);
}
