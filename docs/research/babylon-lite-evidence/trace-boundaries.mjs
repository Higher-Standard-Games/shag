import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
// Research utility. Run from the repository root. It reads source/configuration
// and emits evidence beneath ignored .cache; no application modules execute.
const root = process.cwd();
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const normalize = file => path.relative(root, file).replaceAll('\\', '/');
const cache = new Map();
const runtime = new Map();
const source = new Map();
function resolve(specifier, importer) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@game/') && !specifier.startsWith('@engine/') && !specifier.startsWith('@shared/') && !specifier.startsWith('@games/')) return null;
  const resolved = ts.resolveModuleName(specifier, path.resolve(root, importer), parsed.options, ts.sys).resolvedModule?.resolvedFileName;
  if (!resolved || resolved.includes('node_modules')) return null;
  return normalize(resolved);
}
function edges(ast, importer, declarations) {
  const result = [];
  function add(node, specifier, kind, typeOnly = false) {
    result.push({specifier, target: resolve(specifier, importer), kind, typeOnly, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1});
  }
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const named = clause?.namedBindings;
      const allNamedTypes = named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(x => x.isTypeOnly);
      add(statement, statement.moduleSpecifier.text, 'import', Boolean(clause?.isTypeOnly || (!clause?.name && allNamedTypes)));
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) add(statement, statement.moduleSpecifier.text, 'export', statement.isTypeOnly);
  }
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) add(node, node.arguments[0].text, 'dynamic');
    if (declarations && ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) add(node, node.argument.literal.text, 'import-type', true);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}
function load(file) {
  if (cache.has(file) || !file.endsWith('.ts') || !fs.existsSync(file)) return;
  cache.set(file, true);
  const text = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declared = edges(ast, file, true);
  source.set(file, declared);
  const emitted = ts.transpileModule(text, {fileName: file, compilerOptions: {...parsed.options, noEmit: false, sourceMap: false}}).outputText;
  runtime.set(file, edges(ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true), file, false));
  for (const edge of declared) if (edge.target) load(edge.target);
}
const entries = [
  'src/engine/loader/pk3/PackageStore.ts', 'src/engine/loader/pk3/PK3Index.ts',
  'src/engine/loader/pk3/PK3Loader.ts', 'src/engine/loader/bsp/BspLoader.ts',
  'src/engine/loader/shader/Q3ShaderParser.ts', 'src/engine/loader/shader/Q3ShaderRegistry.ts',
  'src/engine/loader/bsp/mesh/faceBuilders.ts', 'src/engine/loader/bsp/mesh/coordinates.ts',
  'src/engine/loader/bsp/mesh/types.ts', 'src/engine/loader/bsp/mesh/pvs.ts',
  'src/engine/loader/bsp/mesh/spatialBatching.ts', 'src/engine/loader/bsp/mesh/tangents.ts',
  'src/engine/loader/map/MapLoadWait.ts', 'src/engine/loader/map/GpuPreparation.ts',
  'src/engine/loader/model/ModelAsset.ts', 'src/engine/loader/model/TagsLoader.ts',
  'src/engine/loader/model/ModelInstanceCache.ts', 'src/engine/loader/texture/TextureReduction.ts',
  'src/engine/loader/texture/TgaDecoder.ts', 'src/engine/loader/texture/KTX1Loader.ts',
  'src/engine/runtime/BrowserRuntime.ts', 'src/engine/core/EngineServices.ts',
  'src/engine/core/index.ts', 'src/engine/loader/index.ts',
  'src/engine/loader/map/MapLoader.ts', 'src/engine/loader/bsp/BspMeshBuilder.ts',
  'src/engine/camera/FirstPersonPose.ts', 'src/engine/viewport/FirstPersonEffects.ts',
  'src/engine/weapon/voltaic/VoltaicBeamGeometry.ts', 'src/engine/weapon/voltaic/VoltaicProfiles.ts',
  'src/engine/weapon/rail/RailBeamGeometry.ts', 'src/engine/weapon/WeaponBob.ts',
  'src/games/fps/client/RemotePlayerLogic.ts', 'src/games/fps/client/DemoAnimationTimeline.ts',
  'src/games/fps/client/GameEvents.ts', 'src/games/fps/client/SnapshotStateStore.ts',
  'src/games/fps/client/ServerProjectiles.ts', 'src/games/fps/Game.ts',
  'src/games/fps/client/main.ts', 'src/games/fps/client/TimedemoService.ts',
  'src/engine/console/commands/index.ts', 'src/games/fps/client/registerServices.ts',
  'src/engine/loader/bsp/LightGridSampling.ts', 'src/engine/loader/bsp/BspLightingProfile.ts',
  'src/engine/loader/bsp/WorldFog.ts', 'src/engine/loader/bsp/LiquidClassifier.ts',
  'src/engine/rendering/water/WaterDisturbances.ts', 'src/engine/rendering/water/WaterNoise.ts',
  'src/engine/viewport/ViewportDelta.ts', 'src/engine/viewport/PlayerState.ts',
  'src/engine/animation/PlayerAnimationState.ts', 'src/engine/camera/FirstPersonMotion.ts',
  'src/engine/camera/controllers/ViewKick.ts', 'src/engine/lighting/MapAreaLightEntities.ts',
  'src/engine/lighting/MapGodRayEntities.ts', 'src/engine/lighting/MapEmissiveSurfaces.ts',
  'src/engine/rendering/AtmosphericFogShader.ts', 'src/engine/effects/WindSystem.ts',
  'src/engine/weapon/WeaponRecoil.ts', 'src/engine/weapon/WeaponSwitchAnim.ts',
  'src/engine/weapon/AmmoCounterDisplay.ts', 'src/engine/weapon/rail/RailProfiles.ts',
  'src/games/fps/client/PlayerModelVisualSettings.ts',
];
entries.forEach(load);
function trace(entry, graph) {
  const visited = new Set([entry]);
  const queue = [[entry]];
  const externals = new Set();
  let firstBabylon = null;
  for (let i = 0; i < queue.length; i++) {
    const route = queue[i], file = route.at(-1);
    for (const edge of graph.get(file) ?? []) {
      if (edge.specifier.startsWith('@babylonjs/')) {
        externals.add(edge.specifier);
        firstBabylon ??= [...route, edge.specifier];
      }
      if (edge.target && !visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push([...route, edge.target]);
      }
    }
  }
  return {localFiles: visited.size, babylonSpecifiers: [...externals].sort(), firstBabylon};
}
const report = entries.map(entry => ({entry, declared: trace(entry, source), emitted: trace(entry, runtime)}));
fs.mkdirSync('.cache/babylon-lite-research', {recursive: true});
fs.writeFileSync('.cache/babylon-lite-research/boundary-traces.json', JSON.stringify({method: 'TypeScript transpileModule static import/reexport/literal dynamic-import traversal; external package internals and import.meta.glob not traversed', report, source: Object.fromEntries(source), runtime: Object.fromEntries(runtime)}, null, 2));
const summary = {
  typescript: ts.version,
  method: 'Project-local declared and TypeScript-emitted import/reexport/literal dynamic-import graph; JSON targets counted as leaves. Counts include each entry. External-package internals, computed imports and import.meta.glob are not expanded. Not a bundle-size or runtime-execution measurement.',
  entries: report.map(item => ({
    entry: item.entry,
    sourceSha256: createHash('sha256').update(fs.readFileSync(item.entry)).digest('hex'),
    declaredLocalVertices: item.declared.localFiles,
    emittedLocalVertices: item.emitted.localFiles,
    emittedBabylonSpecifiers: item.emitted.babylonSpecifiers.length,
    shortestEmittedBabylonPath: item.emitted.firstBabylon,
  })),
};
fs.writeFileSync('.cache/babylon-lite-research/boundary-summary.json', JSON.stringify(summary, null, 2) + '\n');
for (const item of report) {
  console.log(JSON.stringify({entry: item.entry, declaredFiles: item.declared.localFiles, runtimeFiles: item.emitted.localFiles, runtimeBjs: item.emitted.babylonSpecifiers.length, example: item.emitted.firstBabylon}));
}
