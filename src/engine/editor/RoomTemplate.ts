import type { BoxBrush, EditorDocumentData, Vec3q } from "./EditorDocument";

/** A plain shipped surface: the test room is for playing in, so its walls are drawn, not caulked. */
const shader = "cleansurface/pantonecoolgray10c";
const brush = (id: string, min: Vec3q, max: Vec3q): BoxBrush => ({ id, min, max, shader });

/**
 * A sealed 512x512x256 test room in Quake Z-up coordinates, with one spawn
 * and one light. Without a light entity MakeLight bakes the room black.
 */
export function createRoomTemplate(): EditorDocumentData {
  return {
    schemaVersion: 2,
    draftId: crypto.randomUUID(),
    revision: 0,
    entities: [
      { id: "room-spawn", classname: "info_player_deathmatch", origin: { x: 0, y: 0, z: 48 }, keys: {} },
      { id: "room-light", classname: "light", origin: { x: 0, y: 0, z: 192 }, keys: { light: "300" } },
    ],
    brushes: [
      brush("room-floor", { x: -272, y: -272, z: -16 }, { x: 272, y: 272, z: 0 }),
      brush("room-ceiling", { x: -272, y: -272, z: 256 }, { x: 272, y: 272, z: 272 }),
      brush("room-west", { x: -272, y: -272, z: 0 }, { x: -256, y: 272, z: 256 }),
      brush("room-east", { x: 256, y: -272, z: 0 }, { x: 272, y: 272, z: 256 }),
      brush("room-south", { x: -256, y: -272, z: 0 }, { x: 256, y: -256, z: 256 }),
      brush("room-north", { x: -256, y: 256, z: 0 }, { x: 256, y: 272, z: 256 }),
    ],
  };
}
