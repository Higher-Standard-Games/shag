/**
 * The Node side of the SHAGGED scripting API, shared by the `shagged` CLI and
 * the MCP server: describe a document, compile and publish it, and report on
 * the compiled map. See docs/research/SHAGGED_API.md.
 */
import path from "node:path";
import type { EditOp } from "../api/Operations";
import { type EditorDocumentData, validateDocument } from "../EditorDocument";
import { inspectMapHealth, type MapHealthIssue } from "../MapHealth";
import { writeMap } from "../MapWriter";
import { isBuildQuality } from "./BuildRecipe";
import type { CompileDiagnostics } from "./CompileDiagnostics";
import { CompileJobs } from "./CompileJobs";
import { resolveCompilerConfig } from "./CompilerConfig";
import { pointBounds } from "./DocumentInspection";
import { MapStore } from "./MapStore";
import { resolveServerConfig } from "./ServerConfig";
import { findTexture, loadTextureCatalog, type TextureInfo } from "./TextureLookup";

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Bot, map and compiler code log progress to stdout; keep a caller's stdout for its own output. */
export async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  try {
    return await work();
  } finally {
    console.log = log;
  }
}

function bounds(doc: EditorDocumentData) {
  function* points() {
    for (const brush of doc.brushes) {
      yield brush.min;
      yield brush.max;
    }
    for (const entity of doc.entities) yield entity.origin;
    for (const patch of doc.patches ?? []) for (const row of patch.controlPoints) yield* row;
  }
  return pointBounds(points());
}

/** Counts, bounds and entity classes; with `objects`, every object. */
export function describeDocument(doc: EditorDocumentData, objects = false) {
  const classes: Record<string, number> = {};
  for (const e of [...doc.entities, ...(doc.brushEntities ?? [])])
    classes[e.classname] = (classes[e.classname] ?? 0) + 1;
  return {
    ok: true,
    schemaVersion: doc.schemaVersion,
    draftId: doc.draftId,
    mapName: doc.mapName ?? null,
    worldKeys: structuredClone(doc.worldKeys ?? {}),
    revision: doc.revision,
    counts: {
      brushes: doc.brushes.length,
      patches: doc.patches?.length ?? 0,
      entities: doc.entities.length,
      brushEntities: doc.brushEntities?.length ?? 0,
    },
    entityClasses: classes,
    bounds: bounds(doc),
    ...(objects
      ? {
          brushes: structuredClone(doc.brushes),
          patches: structuredClone(doc.patches ?? []),
          entities: structuredClone(doc.entities),
          brushEntities: structuredClone(doc.brushEntities ?? []),
        }
      : {}),
  };
}

/**
 * Fill in the image size of every `face.material` that names a texture
 * without one, from the texture catalog, so callers only have to name it.
 * Unknown textures are left alone for the operation to reject.
 */
export async function withTextureSizes(ops: readonly EditOp[]): Promise<EditOp[]> {
  const needs = ops.some((op) => op?.op === "face.material" && !op.size && !op.shader?.startsWith("common/"));
  if (!needs) return [...ops];
  const catalog = await quietly(() => loadTextureCatalog());
  return ops.map((op) => {
    if (op?.op !== "face.material" || op.size) return op;
    const size = findTexture(catalog, op.shader)?.size;
    return size ? { ...op, size } : op;
  });
}

/** Map Health, with the texture catalog when given so unknown or imageless shaders are reported too. */
export function healthOf(
  doc: EditorDocumentData,
  textures?: readonly TextureInfo[],
): { ok: boolean; issues: MapHealthIssue[] } {
  const issues = inspectMapHealth(doc, textures);
  return { ok: issues.every((issue) => issue.severity !== "warning"), issues };
}

export interface CompileOutcome {
  ok: boolean;
  state: string;
  stage: string;
  mapName: string;
  revision: number;
  quality: string;
  runtimeMapName: string | null;
  packageName: string | null;
  bspHash: string | null;
  leak: boolean;
  /** True when the current published build already came from these source bytes. */
  reused: boolean;
  logTail: string[];
  jobId: string | null;
  logPath: string | null;
  diagnostics: CompileDiagnostics;
  inputFingerprint: string;
}

/**
 * Save the document as a server revision, compile it with MakeBSP/MakeLight
 * and publish it as a playable package. Reuses the current published build
 * when it came from the same source bytes at the same quality.
 */
export async function compileDocument(
  doc: EditorDocumentData,
  quality?: string,
  force = false,
): Promise<CompileOutcome> {
  validateDocument(doc);
  if (!doc.mapName) throw new PipelineError('the document has no mapName; give it one (lowercase id, e.g. "arena1")');
  const server = resolveServerConfig([]);
  const compiler = await resolveCompilerConfig({});
  if (!compiler.available) throw new PipelineError("the MakeBSP/MakeLight toolchain is not available", { compiler });
  const level = quality ?? compiler.defaultQuality;
  if (!isBuildQuality(level)) throw new PipelineError(`unsupported quality ${level}; use fast, default or release`);
  const store = new MapStore(server.mapsRoot);
  await store.init();
  const name = doc.mapName;
  const current = await store.load(name);
  const source = writeMap(doc);
  const saved =
    current && current.source === source ? current : await store.save(name, source, current?.revision ?? 0, doc);
  const jobs = new CompileJobs(
    store,
    compiler,
    path.resolve(server.mapsRoot, "..", "jobs"),
    undefined,
    server.publishRoot,
  );
  const requested = await jobs.request(name, saved.revision, level, force);
  const job = await jobs.wait(requested.id);
  if (!job) throw new PipelineError("compile job disappeared");
  return {
    ok: job.state === "playable",
    state: job.state,
    stage: job.stage,
    mapName: name,
    revision: saved.revision,
    quality: level,
    runtimeMapName: job.runtimeMapName,
    packageName: job.packageName,
    bspHash: job.bspHash,
    // MakeBSP's leak test prints "LEAKED" and stops the build.
    leak: job.diagnostics.leak,
    reused: job.reused,
    logTail: job.logs.slice(-20),
    jobId: job.id,
    logPath: job.logPath,
    diagnostics: job.diagnostics,
    inputFingerprint: job.inputFingerprint,
  };
}

/**
 * Reachability of the published map. `player` floods the map with the
 * game's own movement (steps, slides, drops, hops) and is the verdict;
 * `bots` is the bots' navigation graph, which also needs to connect for bots
 * to find their way, and misses stairs and other paths a player can take.
 */
export async function mapReachability(doc: EditorDocumentData, mapName: string) {
  const [{ createBotVision }, { BotNavGraph }, { analyzeReachability }, { playerReachability }] = await Promise.all([
    import("../../../bot/BotVision"),
    import("../../../bot/BotNavGraph"),
    import("../api/Reachability"),
    import("./PlayerReach"),
  ]);
  const vision = await createBotVision(mapName);
  if (!vision) return { player: { ok: false, error: `could not load the compiled map "${mapName}"` }, bots: null };
  const knowledge = vision.mapKnowledge;
  const player = playerReachability(
    {
      world: vision.collisionWorld,
      spawns: knowledge.spawnPoints,
      items: knowledge.pickupPositions.map((p) => ({ classname: p.classname, position: p.position })),
      triggers: knowledge.triggerVolumes,
    },
    doc,
  );
  const graph = new BotNavGraph(mapName);
  graph.buildFromVision(vision);
  const bots = analyzeReachability(graph.nodes, graph.edges, doc);
  return {
    player,
    bots: {
      ok: bots.ok,
      unreachableItems: bots.unreachableItems.map((i) => i.objectId ?? i.classname),
      cutOffSpawns: bots.cutOffSpawns.map((s) => s.objectId ?? s.classname),
      navNodes: graph.nodeCount,
      navEdges: graph.edgeCount,
    },
  };
}

/** Health, compile, then reachability of the compiled map, as one verdict. */
export async function mapReport(doc: EditorDocumentData, quality?: string, force = false) {
  const health = healthOf(doc, await quietly(() => loadTextureCatalog()));
  const build = await quietly(() => compileDocument(doc, quality, force));
  const reach = build.ok ? await quietly(() => mapReachability(doc, build.mapName)) : null;
  const reachability = reach?.player ?? { ok: false, error: "skipped: the map did not compile" };
  return {
    ok: health.ok && build.ok && reachability.ok === true,
    health,
    compile: build,
    reachability,
    botNavigation: reach?.bots ?? null,
  };
}
