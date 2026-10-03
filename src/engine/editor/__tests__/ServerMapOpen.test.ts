import { describe, expect, it, vi } from "vitest";
import { EditorDocument } from "../EditorDocument";
import { writeMap } from "../MapWriter";
import { createRoomTemplate } from "../RoomTemplate";
import { inspectServerMap, serverMapName } from "../ServerMapOpen";
import { type ServerMapSnapshot, ShaggedApi, ShaggedApiError } from "../ShaggedApi";

function savedMap(): ServerMapSnapshot {
  const sidecar = new EditorDocument(createRoomTemplate()).snapshot();
  return { name: serverMapName(sidecar.draftId), revision: 3, sourceHash: "hash", source: writeMap(sidecar), sidecar };
}

describe("server map opening", () => {
  it("accepts a matching editable sidecar while preserving a divergent local draft", () => {
    const map = savedMap();
    expect(inspectServerMap(map)).toMatchObject({ kind: "ready", revision: 3 });
    expect(inspectServerMap(map, map.sidecar!)).toMatchObject({ kind: "already-local", revision: 3 });
    const local = structuredClone(map.sidecar!);
    local.brushes[0].max.x += 16;
    expect(inspectServerMap(map, local)).toMatchObject({ kind: "local-conflict", revision: 3 });
    expect(local.brushes[0].max.x).not.toBe(map.sidecar!.brushes[0].max.x);
  });

  it("rejects source-only, mismatched and invalid server snapshots", () => {
    const map = savedMap();
    expect(() => inspectServerMap({ ...map, sidecar: null })).toThrow("no editable");
    expect(() => inspectServerMap({ ...map, source: `${map.source}\n` })).toThrow("does not match");
    expect(() => inspectServerMap({ ...map, name: "another_map" })).toThrow("does not match");
    expect(() => inspectServerMap({ ...map, revision: 0 })).toThrow("Invalid server map revision");
  });

  it("lists and loads saved maps via the browser transport", async () => {
    const map = savedMap();
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/api/maps"))
        return Response.json({ maps: [{ name: map.name, revision: 3, sourceHash: "hash" }] });
      if (url.endsWith(`/api/maps/${map.name}`)) return Response.json(map);
      return Response.json({ error: "Map not found" }, { status: 404 });
    }) as unknown as typeof fetch;
    const api = new ShaggedApi("http://127.0.0.1:9010", fetcher);
    expect(await api.maps()).toEqual([{ name: map.name, revision: 3, sourceHash: "hash" }]);
    expect(inspectServerMap(await api.map(map.name)).kind).toBe("ready");
    expect(await api.mapRevision("missing")).toBe(0);
    await expect(api.map("missing")).rejects.toBeInstanceOf(ShaggedApiError);
  });
});
