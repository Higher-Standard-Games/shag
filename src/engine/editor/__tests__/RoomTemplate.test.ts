import { describe, expect, it } from "vitest";
import { MapParser } from "../../loader/map/MapParser";
import { EditorDocument } from "../EditorDocument";
import { writeMap } from "../MapWriter";
import { createRoomTemplate } from "../RoomTemplate";

describe("closed-room starter", () => {
  it("exports six valid brushes and a player spawn in Quake coordinates", () => {
    const room = createRoomTemplate();
    const document = new EditorDocument(room);
    const source = writeMap(document.snapshot());
    const entities = MapParser.parse(source);
    expect(entities[0].classname).toBe("worldspawn");
    expect(entities[0].brushes).toHaveLength(6);
    expect(entities[1].classname).toBe("info_player_deathmatch");
    expect(entities[1].properties.origin).toBe("0 0 48");
    expect(source).toBe(writeMap(document.snapshot()));
  });
});
