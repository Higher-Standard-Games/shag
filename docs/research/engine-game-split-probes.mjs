// Research probe: only creates Git fixtures under .cache; hides the game virtually, never on disk.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const root = process.cwd();
const fixture = path.resolve('.cache/engine-game-split/git-' + Date.now());
fs.mkdirSync(fixture, { recursive: true });
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Boundary Probe', '-c', 'user.email=boundary-probe@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function init(name, files) { const dir = path.join(fixture, name); fs.mkdirSync(dir); git(dir, 'init', '-b', 'main'); for (const [f, data] of Object.entries(files))
    fs.writeFileSync(path.join(dir, f), data); git(dir, 'add', '--', ...Object.keys(files)); git(dir, 'commit', '-m', 'fixture'); return dir; }
const game = init('game', { 'game.txt': 'standalone game repository\n' });
const sub = init('submodule-consumer', { 'engine.txt': 'engine\n' });
git(sub, '-c', 'protocol.file.allow=always', 'submodule', 'add', game, 'src/games/fps');
const clone = init('clone-consumer', { '.gitignore': 'src/games/fps/\n', 'engine.txt': 'engine\n' });
git(clone, 'clone', game, 'src/games/fps');
const gitProof = { fixture, submoduleAdd: { status: git(sub, 'status', '--short'), trackedEntry: git(sub, 'ls-files', '--stage', 'src/games/fps'), gitmodules: fs.readFileSync(path.join(sub, '.gitmodules'), 'utf8') }, ignoredClone: { status: git(clone, 'status', '--short'), parentTrackedEntry: git(clone, 'ls-files', '--stage', 'src/games/fps'), childHead: git(path.join(clone, 'src/games/fps'), 'rev-parse', 'HEAD') } };
const hidden = path.resolve('src/games/fps').toLowerCase();
const isHidden = f => { const p = path.resolve(f).toLowerCase(); return p === hidden || p.startsWith(hidden + path.sep); };
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parseHost = { ...ts.sys, readDirectory: (...args) => ts.sys.readDirectory(...args).filter(f => !isHidden(f)), fileExists: f => !isHidden(f) && ts.sys.fileExists(f), readFile: f => isHidden(f) ? undefined : ts.sys.readFile(f), directoryExists: f => !isHidden(f) && ts.sys.directoryExists(f) };
const parsed = ts.parseJsonConfigFileContent(config.config, parseHost, root);
function compile(roots, hide = true) { const host = ts.createCompilerHost(parsed.options); const originalGet = host.getSourceFile.bind(host); if (hide) {
    host.fileExists = parseHost.fileExists;
    host.readFile = parseHost.readFile;
    host.directoryExists = parseHost.directoryExists;
    host.getSourceFile = (file, ...args) => isHidden(file) ? undefined : originalGet(file, ...args);
} const program = ts.createProgram(roots, parsed.options, host); const diagnostics = ts.getPreEmitDiagnostics(program); const rows = diagnostics.map(d => ({ file: d.file ? path.relative(root, d.file.fileName).replaceAll('\\', '/') : null, line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') })); return { roots: roots.length, diagnostics: rows }; }
const engineRoots = ['src/engine/index.ts', 'src/vite-env.d.ts', 'src/node-sqlite.d.ts', 'src/ktx2decoder.d.ts'].map(p => path.resolve(p));
const noGame = { currentProject: compile(parsed.fileNames), engineBarrel: compile(engineRoots), baselineEngineBarrel: compile(engineRoots, false), baselineProject: compile(parsed.fileNames, false) };
fs.writeFileSync('.cache/engine-game-split/proofs.json', JSON.stringify({ head: git(root, 'rev-parse', 'HEAD'), fpsHead: git(path.join(root, 'src/games/fps'), 'rev-parse', 'HEAD'), git: gitProof, noGame }, null, 2) + '\n');
console.log(JSON.stringify(gitProof, null, 2));
for (const [name, result] of Object.entries(noGame)) {
    console.log(name + ': ' + result.diagnostics.length + ' diagnostics');
    console.log(JSON.stringify(result.diagnostics.slice(0, 7), null, 2));
}
