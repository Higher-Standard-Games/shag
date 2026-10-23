import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
// Run from the engine repository root. Reads source; writes cache JSON and the research Markdown inventory.
const root = process.cwd();
const norm = p => p.replaceAll('\\', '/');
const tracked = cwd => execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
const outer = tracked(root).filter(p => p.endsWith('.ts') && !p.endsWith('.d.ts'));
const game = tracked(path.join(root, 'src/games/fps')).filter(p => p.endsWith('.ts') && !p.endsWith('.d.ts')).map(p => 'src/games/fps/' + p);
const files = [...new Set([...outer, ...game])];
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const edges = [], nonliteral = [];
const area = p => p.startsWith('src/engine/') ? 'engine' : p.startsWith('src/shared/') ? 'shared' : p.startsWith('src/games/fps/') ? 'fps' : p.startsWith('src/bot/') ? 'bot' : p.startsWith('src/lobby/') ? 'lobby' : p.startsWith('src/cli/') ? 'cli' : p.startsWith('scripts/') ? 'scripts' : 'other';
const test = p => p.includes('/__tests__/') || /\.(test|spec)\.ts$/.test(p);
for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function add(node, arg, typeOnly = false) {
        if (!ts.isStringLiteralLike(arg)) {
            nonliteral.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: arg.getText(source) });
            return;
        }
        const spec = arg.text;
        const found = ts.resolveModuleName(spec, path.join(root, file), options, ts.sys).resolvedModule;
        const to = found ? norm(path.relative(root, found.resolvedFileName)) : null;
        edges.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, spec, to, typeOnly, area: area(file), test: test(file) });
    }
    function walk(node) {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
            const c = node.importClause;
            add(node, node.moduleSpecifier, !!c && (c.isTypeOnly || (!c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.every(e => e.isTypeOnly))));
        }
        else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
            add(node, node.moduleSpecifier, node.isTypeOnly);
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0])
            add(node, node.arguments[0]);
        else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
            add(node, node.argument.literal, true);
        ts.forEachChild(node, walk);
    }
    walk(source);
}
const cross = edges.filter(e => !e.file.startsWith('src/games/fps/') && e.to?.startsWith('src/games/fps/'));
const outbound = edges.filter(e => e.file.startsWith('src/games/fps/') && e.to && area(e.to) !== 'fps' && !e.to.startsWith('node_modules'));
const count = rows => Object.fromEntries([...new Set(rows.map(e => e.area))].sort().map(a => [a, { files: new Set(rows.filter(e => e.area === a).map(e => e.file)).size, imports: rows.filter(e => e.area === a).length }]));
const adjacency = new Map();
for (const e of edges) {
    if (!e.to || e.to.startsWith('node_modules/'))
        continue;
    let list = adjacency.get(e.file);
    if (!list)
        adjacency.set(e.file, list = []);
    list.push(e.to);
}
function route(start) { const q = [[start]], seen = new Set(); while (q.length) {
    const p = q.shift(), f = p.at(-1);
    if (seen.has(f))
        continue;
    seen.add(f);
    if (f.startsWith('src/games/fps/'))
        return p;
    for (const next of adjacency.get(f) ?? [])
        q.push([...p, next]);
} return null; }
const engineTransitive = files.filter(f => area(f) === 'engine' && !test(f)).map(file => ({ file, path: route(file) })).filter(e => e.path);
const sharedWeapon = edges.filter(e => !e.file.startsWith('src/games/fps/') && e.to?.startsWith('src/shared/entities/definitions/'));
const result = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fpsHead: execFileSync('git', ['-C', 'src/games/fps', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fileCount: files.length, production: count(cross.filter(e => !e.test)), tests: count(cross.filter(e => e.test)), cross, outbound, nonliteral, engineTransitive, sharedWeapon, assetImports: edges.filter(e => e.area === 'engine' && !e.test && (e.spec.includes('?') || e.spec.endsWith('.json'))), engineExternal: edges.filter(e => e.area === 'engine' && !e.test && e.to && !e.to.startsWith('src/engine/') && !e.to.startsWith('src/shared/') && !e.to.startsWith('node_modules/')) };
fs.mkdirSync('.cache/engine-game-split', { recursive: true });
fs.writeFileSync('.cache/engine-game-split/inventory.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ head: result.head, fpsHead: result.fpsHead, files: files.length, production: result.production, tests: result.tests, transitiveEngine: engineTransitive.length, outboundGameFiles: new Set(outbound.map(e => e.file)).size, nonliteral: nonliteral.length }, null, 2));
for (const group of ['engine', 'lobby', 'bot', 'cli', 'other', 'scripts']) {
    console.log(group + ':');
    for (const f of [...new Set(cross.filter(e => e.area === group && !e.test).map(e => e.file))])
        console.log(' ' + f);
}
// Checked-in human-readable snapshot; the complete machine-readable edges stay in .cache.
const code = value => '`' + String(value).replaceAll('|', '\\|') + '`';
const md = [];
md.push('# Engine/game boundary inventory', '', 'Generated by `node docs/research/engine-game-split-audit.mjs`.', '', 'Source engine: ' + code(result.head) + '. Game: ' + code(result.fpsHead) + '.', '', 'Read with [the refactoring plan](./ENGINE_GAME_SPLIT.md). Line numbers describe this source snapshot, not a stable API.', '', 'The scan covers ' + files.length + ' tracked TypeScript files, excluding declaration files. It includes static imports, type imports, reexports and literal dynamic imports. Nonliteral calls, raw assets and JS/config strings need separate review.', '');
function fileTable(rows) { md.push('| Importer | Sites | Resolved game modules |', '| --- | --- | --- |'); for (const file of [...new Set(rows.map(e => e.file))].sort()) {
    const items = rows.filter(e => e.file === file);
    md.push('| ' + code(file) + ' | ' + items.map(e => code(':' + e.line + (e.typeOnly ? ' type' : ''))).join(', ') + ' | ' + [...new Set(items.map(e => e.to))].map(code).join('<br>') + ' |');
} md.push(''); }
md.push('## Direct production source imports', '', new Set(cross.filter(e => !e.test && e.file.startsWith('src/')).map(e => e.file)).size + ' production `src` files have ' + cross.filter(e => !e.test && e.file.startsWith('src/')).length + ' import sites into the game.');
for (const group of ['engine', 'bot', 'lobby', 'cli']) {
    md.push('### ' + group, '');
    fileTable(cross.filter(e => !e.test && e.area === group));
}
md.push('### Application root', '');
fileTable(cross.filter(e => !e.test && e.file === 'src/main.ts'));
md.push('## Outer tests and fixtures', '', new Set(cross.filter(e => e.test).map(e => e.file)).size + ' files, ' + cross.filter(e => e.test).length + ' import sites. Move integration coverage with its owner or inject neutral engine fixtures; do not delete coverage.', '');
fileTable(cross.filter(e => e.test));
md.push('## Executable scripts and historical probes', '');
fileTable(cross.filter(e => !e.test && !e.file.startsWith('src/')));
md.push('## Transitive engine exposure', '', engineTransitive.length + ' production engine modules have a path to game source, including type-only paths. These are shortest resolved source paths, not proof that all paths execute or enter a runtime bundle.', '', '| Engine source | Path to Washoi |', '| --- | --- |');
for (const item of engineTransitive)
    md.push('| ' + code(item.file) + ' | ' + item.path.map(code).join(' → ') + ' |');
md.push('');
md.push('## Engine dependencies on sibling applications and concrete recipes', '', '| Engine source | Site | Resolved target |', '| --- | --- | --- |');
for (const e of result.engineExternal.filter(e => !e.to.startsWith('src/games/fps/')))
    md.push('| ' + code(e.file) + ' | ' + e.line + ' | ' + code(e.to) + ' |');
md.push('');
md.push('### Raw/JSON asset imports', '', '| Engine source | Site | Specifier |', '| --- | --- | --- |');
for (const e of result.assetImports)
    md.push('| ' + code(e.file) + ' | ' + e.line + ' | ' + code(e.spec) + ' |');
md.push('', '`?raw` assets may not resolve through the TypeScript module resolver; Vite still bundles them. The editor catalog is a concrete Washoi dependency even though it is outside the FPS gitlink.', '');
md.push('## Concrete shared-definition consumers', '', 'These imports do not point into the submodule. They demonstrate why a source-path-only gate is not sufficient. All below are non-game importers, including tests and definition barrels.', '', '| Source | Sites | Concrete shared target |', '| --- | --- | --- |');
for (const file of [...new Set(sharedWeapon.map(e => e.file))].sort()) {
    const items = sharedWeapon.filter(e => e.file === file);
    md.push('| ' + code(file) + ' | ' + items.map(e => e.line).join(', ') + ' | ' + [...new Set(items.map(e => e.to))].map(code).join('<br>') + ' |');
}
md.push('');
md.push('## Reverse direction: game imports parent code', '', new Set(outbound.map(e => e.file)).size + ' game files import resolved parent repository modules. This direction is expected for engine APIs. The nested-checkout plan preserves it initially; imports of moved game-owned parent modules need mechanical updates. Full per-import targets are in the generated JSON.', '', '<details>', '<summary>All ' + new Set(outbound.map(e => e.file)).size + ' affected game source/test files</summary>', '', '| Game source | Parent namespaces |', '| --- | --- |');
for (const file of [...new Set(outbound.map(e => e.file))].sort()) {
    const targets = outbound.filter(e => e.file === file).map(e => e.to);
    md.push('| ' + code(file) + ' | ' + [...new Set(targets.map(p => p.split('/').slice(0, 3).join('/')))].map(code).join(', ') + ' |');
}
md.push('', '</details>', '');
md.push('## Nonliteral imports: manual review', '', '| Source | Site | Expression |', '| --- | --- | --- |');
for (const item of nonliteral)
    md.push('| ' + code(item.file) + ' | ' + item.line + ' | ' + code(item.text) + ' |');
md.push('', 'TFBackend selects its TensorFlow backend package. Electron main reconstructs a game.json path and needs the packaging review in the plan.', '', '## What this inventory does not establish', '', '- It does not prove runtime parity or a game-free build.', '- Root manifests/HTML, package scripts, build tools, CI, deployment, raw gamepacks, concrete shared policy/data and dynamically constructed strings require the ownership checklist in the main plan.', '- TypeScript resolution follows the current fixed FPS aliases; this is not a multi-game resolver implementation.', '- Historical research imports are listed for completeness and must not be confused with active engine production code.', '');
fs.writeFileSync('docs/research/ENGINE_GAME_SPLIT_INVENTORY.md', md.join('\n'));
