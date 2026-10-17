import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDocument } from "../../EditorDocument";
import { writeMap } from "../../MapWriter";
import { archPatch } from "../../PatchPresets";
import { inspectServerMap } from "../../ServerMapOpen";
import { MapConflictError, MapStore } from "../MapStore";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function store(): Promise<MapStore> {
  const root = await mkdtemp(path.join(tmpdir(), "shagged-store-"));
  roots.push(root);
  const result = new MapStore(root);
  await result.init();
  return result;
}

describe("SHAGGED server map storage", () => {
  it("opens legacy patch row-order sidecars and saves a native revision without altering history", async () => {
    const maps = await store(),
      data = new EditorDocument().snapshot();
    data.mapName = "legacy_patch";
    data.patches = [
      archPatch("arch", "common/caulk", {
        axes: { u: "x", v: "y", hidden: "z" },
        start: [0, 0],
        end: [64, 64],
        depth: [0, 32],
      })!,
    ];
    const legacy = writeMap(data, { legacyPatchRows: true }),
      native = writeMap(data);
    expect(native).not.toBe(legacy);
    const saved = await maps.save("legacy_patch", legacy, 0, data);
    expect(inspectServerMap(saved).kind).toBe("ready");
    expect((await new MapStore(maps.root).load("legacy_patch"))!.source).toBe(legacy);
    const next = await maps.save("legacy_patch", native, 1, data);
    expect(next.revision).toBe(2);
    expect(inspectServerMap(next).document.snapshot().patches).toEqual(data.patches);
    const changed = structuredClone(data);
    changed.patches![0].controlPoints[0][0].x += 1;
    await expect(maps.save("legacy_patch", legacy, 2, changed)).rejects.toThrow(/sidecar does not match/);
  });
  it("retains editor-only groups even when exported compiler source is unchanged", async () => {
    const maps = await store();
    const data = new EditorDocument().snapshot();
    data.brushes = [0, 128].map((x, i) => ({
      id: `box-${i}`,
      min: { x, y: 0, z: 0 },
      max: { x: x + 64, y: 64, z: 64 },
      shader: "common/caulk",
    }));
    const source = writeMap(data);
    await maps.save("grouped_room", source, 0, data);
    data.editorGroups = [
      { id: "assembly", name: "Assembly", objectIds: data.brushes.slice(0, 2).map((brush) => brush.id) },
    ];
    expect(writeMap(data)).toBe(source);
    await maps.save("grouped_room", source, 1, data);
    const restored = await new MapStore(maps.root).load("grouped_room");
    expect(restored?.revision).toBe(2);
    expect(restored?.sidecar?.editorGroups).toEqual(data.editorGroups);
  });

  it("keeps numbered source and matching editor sidecar through a restart", async () => {
    const maps = await store();
    const data = new EditorDocument().snapshot();
    const source = writeMap(data);
    const first = await maps.save("test_room", source, 0, data);
    expect(first.revision).toBe(1);
    expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await new MapStore(maps.root).load("test_room")).toEqual(first);
    const second = await maps.save("test_room", `${source}// second revision\n`, 1);
    expect(second.revision).toBe(2);
    expect(second.sidecar).toBeNull();
    expect(await maps.list()).toEqual([{ name: "test_room", revision: 2, sourceHash: second.sourceHash }]);
  });

  it("rejects stale concurrent saves, invalid names, and sidecars that disagree with source", async () => {
    const maps = await store();
    const data = new EditorDocument().snapshot();
    const source = writeMap(data);
    const results = await Promise.allSettled([
      new MapStore(maps.root).save("arena", source, 0, data),
      maps.save("arena", source, 0, data),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]).toMatchObject({
      reason: new MapConflictError("Map revision is 1; expected 0"),
    });
    await expect(maps.save("../escape", source, 0)).rejects.toThrow("Map name");
    await expect(maps.save("arena", `${source}// changed\n`, 1, data)).rejects.toThrow("sidecar does not match");
    expect((await maps.load("arena"))?.revision).toBe(1);
  });
});
