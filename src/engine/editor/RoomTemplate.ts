import type { BoxBrush, EditorDocumentData, Vec3q } from "./EditorDocument";

const shader = "blx/blx_grid";
const brush = (id: string, min: Vec3q, max: Vec3q): BoxBrush => ({ id, min, max, shader });

/** A sealed 512x512x256 test room with one spawn, in Quake Z-up coordinates. */
export function createRoomTemplate(): EditorDocumentData {
  return {
    schemaVersion: 1,
    draftId: crypto.randomUUID(),
    revision: 0,
    testSpawn: { x: 0, y: 0, z: 48 },
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
