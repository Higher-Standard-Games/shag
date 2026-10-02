import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDocument } from "../../EditorDocument";
import { writeMap } from "../../MapWriter";
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
      maps.save("arena", source, 0, data),
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
