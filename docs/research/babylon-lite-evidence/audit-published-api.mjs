import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

// Research only: read source, published declarations and tarballs; execute none
// of the application or downloaded packages. Acquire the pinned tarballs first.
const root = process.cwd();
const cache = path.join(root, '.cache/babylon-lite-research/published-api');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(root, file).replaceAll('\\', '/');
function walk(directory, include) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(file, include));
    else if (include(file)) files.push(file);
  }
  return files.sort();
}
function declarations(file) {
  const bytes = fs.readFileSync(file);
  const ast = ts.createSourceFile(file, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
  const exports = new Set();
  for (const statement of ast.statements) {
    if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (statement.name && ts.isIdentifier(statement.name)) exports.add(statement.name.text);
      if (ts.isVariableStatement(statement)) for (const decl of statement.declarationList.declarations)
        if (ts.isIdentifier(decl.name)) exports.add(decl.name.text);
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause))
      for (const specifier of statement.exportClause.elements) exports.add(specifier.name.text);
  }
  return { sha256: sha256(bytes), exports: [...exports].sort() };
}
const packages = {};
for (const slug of ['lite', 'compat']) {
  const metadata = JSON.parse(fs.readFileSync(path.join(cache, `${slug}-metadata.json`), 'utf8').replace(/^\uFEFF/, ''));
  const bytes = fs.readFileSync(path.join(cache, `${slug}.tgz`));
  const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (actual !== metadata.dist.integrity) throw new Error(`Tarball integrity mismatch: ${slug}`);
  packages[slug] = {
    name: metadata.name, version: metadata.version, gitHead: metadata.gitHead,
    tarball: metadata.dist.tarball, integrity: actual, tarballSha256: sha256(bytes),
    declaration: declarations(path.join(cache, slug, 'package/index.d.ts')),
  };
}
const rows = new Map();
const sideEffects = [];
const dynamicImports = [];
const sourceFiles = walk(path.join(root, 'src'), file => file.endsWith('.ts') && !file.endsWith('.d.ts'));
const sourceHashes = [];
function scope(file) {
  if (file.includes('/__tests__/') || /\.(test|spec)\.ts$/.test(file)) return 'tests';
  if (file.startsWith('src/engine/editor/')) return 'editor';
  if (file.startsWith('src/engine/console/') || file.startsWith('src/cli/')) return 'tools';
  if (file.startsWith('src/games/fps/')) return 'fps';
  return 'engine-and-other';
}
for (const file of sourceFiles) {
  const bytes = fs.readFileSync(file), local = relative(file);
  const ast = ts.createSourceFile(file, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
  let found = false;
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    if (!module.startsWith('@babylonjs/')) continue;
    found = true;
    const site = { file: local, scope: scope(local), module, line: ast.getLineAndCharacterOfPosition(statement.getStart(ast)).line + 1 };
    const clause = statement.importClause;
    if (!clause) { sideEffects.push(site); continue; }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) {
      const name = (element.propertyName ?? element.name).text;
      const row = rows.get(name) ?? { name, compatExportDeclared: packages.compat.declaration.exports.includes(name), uses: [] };
      row.uses.push({ ...site, typeOnly: clause.isTypeOnly || element.isTypeOnly });
      rows.set(name, row);
    }
    if (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)))
      sideEffects.push({ ...site, kind: 'default-or-namespace-binding-not-symbol-matched' });
  }
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('@babylonjs/')) {
      found = true;
      dynamicImports.push({file: local, scope: scope(local), module: node.arguments[0].text, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1});
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (found) sourceHashes.push({ file: local, sha256: sha256(bytes) });
}
const symbols = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
const result = {
  method: 'Syntactic named Babylon import inventory across src/*.ts (recursive), split by scope, compared only with exported names in pinned published compat declarations. Type-only flags are syntactic. No runtime reachability, instance-method resolution, signature equivalence or working-implementation claim. Literal dynamic imports and side-effect modules recorded separately; computed imports, external internals, .tsx and scripts/ are not covered.',
  typescript: ts.version,
  packages,
  counts: { scannedTsFiles: sourceFiles.length, babylonImporterFiles: sourceHashes.length, namedSymbols: symbols.length, missingCompatExportNames: symbols.filter(row => !row.compatExportDeclared).length, sideEffectOrNamespaceSites: sideEffects.length, literalDynamicSites: dynamicImports.length },
  missingCompatExportNames: symbols.filter(row => !row.compatExportDeclared).map(row => row.name),
  symbols, sideEffects, dynamicImports, sourceHashes,
};
fs.writeFileSync(path.join(cache, 'api-import-audit.json'), JSON.stringify(result, null, 2) + '\n');
const nativeProbes = [
  'createEngine', 'createSceneContext', 'createFreeCamera', 'createMeshFromData',
  'addToScene', 'registerScene', 'renderFrame', 'startEngine', 'onBeforeRender',
  'onEngineGpuError', 'onEngineDeviceLost', 'enableSurfaceResizeObserver',
  'disposeScene', 'disposeEngine', 'waitForGpuIdle', 'getEngineLimits',
  'createRenderTask', 'createRenderTarget', 'addMeshToTask', 'getFrameGraph',
  'addTask', 'removeTask', 'setMeshVisible', 'markMeshRenderableDirty',
  'createShaderMaterial', 'MaterialPlugin', 'PluginSamplerDecl', 'ShaderSamplerDecl',
  'createTexture2DArrayFromPixels', 'createTexture2DArrayFromKtx2',
  'loadTexture2D', 'loadCubeTexture', 'setKtx2DecoderUrl',
  'createTexture2DFromPixels', 'enablePbrLightmap', 'setPbrLightmap',
  'enablePbrLocalCubemap', 'enableMaterialUvTransform', 'setTextureTransform',
  'setThinInstances', 'setThinInstanceColors', 'setThinInstanceDrawCount',
  'createStorageBuffer', 'updateStorageBufferRange', 'createRenderShader',
  'createRenderDrawTask', 'createRenderDraw', 'createRenderBindingSet', 'setRenderDrawCount', 'RenderShaderOptions',
  'computeTextureViewBinding', 'createCustomPostProcessTask', 'createUniformEffectWrapper',
  'createEffectRenderTask', 'createGeometryRendererTask', 'withSampledDepthTexture',
  'loadGltf', 'cloneTransformNode', 'enableBoneControl', 'goToFrame',
  'setAnimationWeight', 'setAnimationAdditive', 'setBoneWorldPoseDeferred',
  'setThinInstanceCount', 'setThinInstanceMatrix', 'enableThinInstanceDynamicDrawCount',
  'enableThinInstanceGpuCulling', 'setThinInstanceLodPartner',
  'createHierarchyInstancePool', 'setHierarchyInstanceMatrix',
  'prepareVat', 'prepareVatMany', 'createVatBakeResult', 'createVatBakeResults',
  'attachVat', 'setVatInstanceStorage', 'setVatTime',
  'createComputeTask', 'setRenderDrawIndirect',
  'setRenderTaskGpuTimingEnabled', 'getRenderTaskGpuTimings', 'measureRenderTaskOverdrawCost',
  'createAudioEngineAsync', 'PhysicsCharacterController',
];
const runtimeExports = declarations(path.join(cache, 'lite/package/lib/index.js')).exports;
const nativeImplementationFiles = [
  'lib/engine/engine.js', 'lib/engine/engine-gpu-events.js',
  'lib/scene/transform-node.js', 'lib/frame-graph/frame-graph.js',
  'lib/frame-graph/render-task.js', 'lib/material/shader/shader-material.js',
  'lib/material/shader/shader-pipeline.js', 'lib/animation/animation-group.js',
  'lib/material/enable-material-uv-transform.js', 'lib/texture/texture-metadata.js',
  'lib/mesh/thin-instance.js', 'lib/mesh/thin-instance-gpu.js',
  'lib/mesh/hierarchy-instance-pool.js', 'lib/scene/visibility.js',
  'lib/frame-graph/render-task-base.js', 'lib/frame-graph/render-task-transaction.js',
  'lib/vat/vat-baker.js', 'lib/engine/gpu-task-timing.js',
];
const compatSourceSuffixes = [
  'src/scene/scene.ts', 'src/meshes/meshes.ts', 'src/materials/material-plugin.ts',
  'src/loading/scene-loader.ts', 'src/bones/skeleton.ts',
  'src/textures/raw-texture-2d-array.ts', 'src/textures/textures.ts',
  'src/unsupported/unsupported-apis.ts',
];
const nativePerformanceSourceFiles = [
  'src/engine/loader/bsp/mesh/spatialBatching.ts',
  'src/engine/rendering/WeaponCameraCandidates.ts',
  'src/engine/weapon/voltaic/VoltaicEffectRenderer.ts',
  'src/engine/weapon/explosion/ExplosionBatchRenderer.ts',
  'src/engine/animation/PlayerModelManager.ts',
  'src/engine/loader/shader/Q3ShaderMaterialFactory.ts',
  'src/engine/loader/shader/ShaderAnimationSystem.ts',
  'src/engine/rendering/FrozenWorldMaterials.ts',
  'src/engine/rendering/water/WaterProbeCache.ts',
  'src/engine/loader/map/MapLoader.ts',
];
const compatSources = new Map();
for (const file of walk(path.join(cache, 'compat/package'), file => file.endsWith('.js.map'))) {
  const sourceMap = JSON.parse(fs.readFileSync(file, 'utf8'));
  sourceMap.sources.forEach((source, index) => {
    const suffix = compatSourceSuffixes.find(suffix => source.replaceAll('\\', '/').endsWith(suffix));
    const content = sourceMap.sourcesContent?.[index];
    if (suffix && typeof content === 'string') compatSources.set(suffix, {source: suffix, map: path.relative(path.join(cache, 'compat/package'), file).replaceAll('\\', '/'), sha256: sha256(content)});
  });
}
if (compatSources.size !== compatSourceSuffixes.length) throw new Error('Selected published compat source-map evidence is incomplete');
const summary = {
  method: result.method,
  typescript: result.typescript,
  packages: Object.fromEntries(Object.entries(packages).map(([slug, record]) => [slug, {
    name: record.name, version: record.version, gitHead: record.gitHead,
    tarball: record.tarball, integrity: record.integrity, tarballSha256: record.tarballSha256,
    declarationSha256: record.declaration.sha256, declarationExportNames: record.declaration.exports.length,
  }])),
  counts: result.counts,
  missingCompatExportNames: result.missingCompatExportNames,
  nativeProbes: nativeProbes.map(name => ({ name, declared: packages.lite.declaration.exports.includes(name), runtimeExport: runtimeExports.includes(name) })),
  inspectedImplementationHashes: {
    native: nativeImplementationFiles.map(file => ({file, sha256: sha256(fs.readFileSync(path.join(cache, 'lite/package', file)))})),
    compatSourceMapContents: [...compatSources.values()].sort((a, b) => a.source.localeCompare(b.source)),
  },
  symbols: symbols.map(row => ({
    name: row.name, compatExportDeclared: row.compatExportDeclared,
    sites: row.uses.length,
    syntacticValueSites: row.uses.filter(site => !site.typeOnly).length,
    scopes: [...new Set(row.uses.map(site => site.scope))].sort(),
    examples: row.uses.slice(0, 2),
  })),
  importerSourceHashes: sourceHashes,
  nativePerformanceSourceHashes: nativePerformanceSourceFiles.map(file => ({file, sha256: sha256(fs.readFileSync(path.join(root, file)))})),
};
fs.writeFileSync(path.join(cache, 'published-api-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(result.counts));
console.log(`Missing compat export names (not a native-feature absence list): ${result.missingCompatExportNames.join(', ')}`);
