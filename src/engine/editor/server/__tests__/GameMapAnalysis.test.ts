import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDocumentData } from "../../EditorDocument";
import { mapReachability } from "../AgentPipeline";
import { clearGameMapAnalysis, type MapReachabilityResult, registerGameMapAnalysis } from "../GameMapAnalysis";

const doc: EditorDocumentData = { schemaVersion: 2, draftId: "analysis", revision: 0, brushes: [], entities: [] };
afterEach(clearGameMapAnalysis);

describe("game map analysis boundary", () => {
  it("reports analysis unavailable without a game instead of silently succeeding", async () => {
    clearGameMapAnalysis();
    expect(await mapReachability(doc, "arena")).toEqual({
      player: { ok: false, error: "Map reachability unavailable: no game analysis provider registered" },
      bots: null,
    });
  });

  it("forwards the original document and map name and retains the provider's verdict", async () => {
    const result: MapReachabilityResult = {
      player: { ok: true, spawns: 2, items: 1, unreachableItems: [], cutOffSpawns: [], positions: 17 },
      bots: { ok: false, unreachableItems: ["item"], cutOffSpawns: ["spawn"], navNodes: 3, navEdges: 2 },
    };
    const analyze = vi.fn(async () => result);
    registerGameMapAnalysis({ mapReachability: analyze });
    expect(await mapReachability(doc, "custom-arena")).toBe(result);
    expect(analyze).toHaveBeenCalledWith(doc, "custom-arena");
    clearGameMapAnalysis();
    expect((await mapReachability(doc, "custom-arena")).player.ok).toBe(false);
  });

  it("preserves provider failures for the caller", async () => {
    const failure = new Error("collision data unavailable");
    registerGameMapAnalysis({
      mapReachability: async () => {
        throw failure;
      },
    });
    await expect(mapReachability(doc, "arena")).rejects.toBe(failure);
  });
});
