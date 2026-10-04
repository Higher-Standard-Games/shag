import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { resolveMapBspViaIndex } from "../../../loader/pk3/NodePk3";
import { writeMap } from "../../MapWriter";
import { createRoomTemplate } from "../../RoomTemplate";
import { CompileJobs } from "../CompileJobs";
import { resolveCompilerConfig } from "../CompilerConfig";
import { MapStore } from "../MapStore";

it("compiles a room, publishes its PK3, and resolves the playable BSP headlessly", async () => {
  const compiler = await resolveCompilerConfig();
  if (!compiler.available) return; // Local binaries and game data are optional in CI.
  const root = await mkdtemp(path.join(tmpdir(), "shagged-playtest-"));
  try {
    const store = new MapStore(path.join(root, "maps"));
    await store.init();
    const room = createRoomTemplate();
    const saved = await store.save("playtestprobe", writeMap(room), 0, room);
    const dataRoot = path.join(root, "data");
    const jobs = new CompileJobs(store, compiler, path.join(root, "jobs"), undefined, dataRoot);
    const requested = await jobs.request("playtestprobe", saved.revision, "fast");
    const completed = await jobs.wait(requested.id);
    expect(completed?.state, completed?.logs.join("\n")).toBe("playable");
    expect(completed?.runtimeMapName).toBe("playtestprobe");
    const bsp = await resolveMapBspViaIndex([dataRoot], "playtestprobe");
    expect(new TextDecoder().decode(new Uint8Array(bsp!, 0, 4))).toBe("FBSP");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
