import type { ReachabilityReport } from "../api/Reachability";
import type { EditorDocumentData } from "../EditorDocument";

export interface MapReachabilityResult {
  player: (ReachabilityReport & { positions: number }) | { ok: false; error: string };
  bots: {
    ok: boolean;
    unreachableItems: string[];
    cutOffSpawns: string[];
    navNodes: number;
    navEdges: number;
  } | null;
}

/** Game-owned analysis of a published map; register in the Node composition root. */
export interface GameMapAnalysis {
  mapReachability(doc: EditorDocumentData, mapName: string): Promise<MapReachabilityResult>;
}

let analysis: GameMapAnalysis | null = null;

export function registerGameMapAnalysis(value: GameMapAnalysis): void {
  analysis = value;
}

export function getGameMapAnalysis(): GameMapAnalysis | null {
  return analysis;
}

export function clearGameMapAnalysis(): void {
  analysis = null;
}
