/**
 * SHAGGED scripting CLI: edit a map document with typed operations, check it,
 * export it and compile it, without the browser editor. Output is JSON so
 * scripts and AI agents can read it; see docs/research/SHAGGED_API.md.
 *
 *   npm run shagged -- new <doc.json> [--name <mapid>] [--room] [--force]
 *   npm run shagged -- apply <doc.json> <ops.json|-> [--dry-run]
 *   npm run shagged -- info <doc.json> [--objects]
 *   npm run shagged -- health <doc.json>
 *   npm run shagged -- export <doc.json> [out.map]
 *   npm run shagged -- compile <doc.json> [--quality fast|default|release]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applyOperations, type EditOp, emptyDocument, OperationError } from "../engine/editor/api/Operations";
import { type EditorDocumentData, migrateDocument, validateDocument } from "../engine/editor/EditorDocument";
import { inspectMapHealth } from "../engine/editor/MapHealth";
import { writeMap } from "../engine/editor/MapWriter";
import { createRoomTemplate } from "../engine/editor/RoomTemplate";

const USAGE = `Usage: npm run shagged -- <command> ...
  new <doc.json> [--name <mapid>] [--room] [--force]   create a document (optionally the sealed test room)
  apply <doc.json> <ops.json|-> [--dry-run]            apply a batch of operations (JSON array, {ops:[...]} or JSON Lines)
  info <doc.json> [--objects]                          counts, bounds and (optionally) every object
  health <doc.json>                                    Map Health issues
  export <doc.json> [out.map]                          deterministic .map source (stdout without a file)
  compile <doc.json> [--quality fast|default|release]  save as a server revision, run MakeBSP/MakeLight, publish`;

function out(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message: string, extra: Record<string, unknown> = {}): never {
  out({ ok: false, error: message, ...extra });
  process.exit(1);
}

function readDoc(file: string): EditorDocumentData {
  if (!existsSync(file)) fail(`no document at ${file}; create one with: npm run shagged -- new ${file}`);
  const doc = migrateDocument(JSON.parse(readFileSync(file, "utf8")));
  validateDocument(doc);
  return doc;
}

function writeDoc(file: string, doc: EditorDocumentData): void {
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

function readOps(source: string): EditOp[] {
  const text = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.ops)) return parsed.ops;
    if (parsed && typeof parsed.op === "string") return [parsed];
  } catch {
    // Fall through to JSON Lines.
  }
  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("//"))
    .map((line, index): EditOp => {
      try {
        return JSON.parse(line);
      } catch {
        return fail(`line ${index + 1} of the operations is not JSON`);
      }
    });
}

function bounds(doc: EditorDocumentData) {
  const points = [
    ...doc.brushes.flatMap((b) => [b.min, b.max]),
    ...doc.entities.map((e) => e.origin),
    ...(doc.patches ?? []).flatMap((p) => p.controlPoints.flat()),
  ];
  if (!points.length) return null;
  const pick = (f: (...n: number[]) => number) => ({
    x: f(...points.map((p) => p.x)),
    y: f(...points.map((p) => p.y)),
    z: f(...points.map((p) => p.z)),
  });
  return { min: pick(Math.min), max: pick(Math.max) };
}

function info(doc: EditorDocumentData, objects: boolean) {
  const classes: Record<string, number> = {};
  for (const e of [...doc.entities, ...(doc.brushEntities ?? [])])
    classes[e.classname] = (classes[e.classname] ?? 0) + 1;
  return {
    ok: true,
    mapName: doc.mapName ?? null,
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
          brushes: doc.brushes.map((b) => ({ id: b.id, min: b.min, max: b.max, shader: b.shader })),
          entities: doc.entities.map((e) => ({ id: e.id, classname: e.classname, origin: e.origin, keys: e.keys })),
          brushEntities: doc.brushEntities ?? [],
        }
      : {}),
  };
}

async function compile(doc: EditorDocumentData, quality: string | undefined) {
  if (!doc.mapName) fail('the document has no mapName; set one with: new --name <mapid>, or add "mapName" to the JSON');
  const [{ MapStore }, { CompileJobs }, { resolveCompilerConfig }, { resolveServerConfig }, { isBuildQuality }] =
    await Promise.all([
      import("../engine/editor/server/MapStore"),
      import("../engine/editor/server/CompileJobs"),
      import("../engine/editor/server/CompilerConfig"),
      import("../engine/editor/server/ServerConfig"),
      import("../engine/editor/server/BuildRecipe"),
    ]);
  const server = resolveServerConfig([]);
  const compiler = await resolveCompilerConfig({});
  if (!compiler.available) fail("the MakeBSP/MakeLight toolchain is not available", { compiler });
  const level = quality ?? compiler.defaultQuality;
  if (!isBuildQuality(level)) fail(`unsupported quality ${level}`);
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
  const requested = await jobs.request(name, saved.revision, level);
  const job = await jobs.wait(requested.id);
  if (!job) fail("compile job disappeared");
  const log = job.logs.join("");
  // MakeBSP's leak test prints "LEAKED" and stops the build.
  const leak = /LEAKED/.test(log);
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
    leak,
    logTail: job.logs.slice(-12).join("").split(/\r?\n/).filter(Boolean).slice(-20),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const positional = args.filter(
    (arg, index) => !arg.startsWith("--") && !args[index - 1]?.match(/^--(name|quality)$/),
  );
  const [command, file, third] = positional;
  if (!command || flag("--help") || flag("-h")) {
    console.log(USAGE);
    return;
  }
  if (!file) fail(`${command} needs a document path\n${USAGE}`);

  switch (command) {
    case "new": {
      if (existsSync(file) && !flag("--force")) fail(`${file} exists; pass --force to replace it`);
      const doc = flag("--room") ? createRoomTemplate() : emptyDocument();
      const name = value("--name");
      if (name) doc.mapName = name;
      validateDocument(doc);
      writeDoc(file, doc);
      out(info(doc, false));
      return;
    }
    case "apply": {
      if (!third) fail("apply needs an operations file, or - for stdin");
      const doc = readDoc(file);
      try {
        const result = applyOperations(doc, readOps(third));
        const dryRun = flag("--dry-run");
        if (!dryRun) writeDoc(file, result.doc);
        out({
          ok: true,
          dryRun,
          revision: result.doc.revision,
          created: result.created,
          changed: result.changed,
          deleted: result.deleted,
          issues: result.issues,
        });
      } catch (error) {
        if (error instanceof OperationError) fail(error.message, { index: error.index, operation: error.operation });
        throw error;
      }
      return;
    }
    case "info":
      out(info(readDoc(file), flag("--objects")));
      return;
    case "health": {
      const issues = inspectMapHealth(readDoc(file));
      out({ ok: issues.every((issue) => issue.severity !== "warning"), issues });
      return;
    }
    case "export": {
      const source = writeMap(readDoc(file));
      if (third) {
        writeFileSync(third, source);
        out({ ok: true, file: third, bytes: Buffer.byteLength(source) });
      } else process.stdout.write(source);
      return;
    }
    case "compile": {
      const result = await compile(readDoc(file), value("--quality"));
      out(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    default:
      fail(`unknown command ${command}\n${USAGE}`);
  }
}

// The compile job runner can leave handles open; the result is printed, so leave now.
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => fail(error instanceof Error ? error.message : String(error)));
