// Verify the engine browser entry with game source directories unavailable.
import path from 'node:path';
import ts from 'typescript';
import { build } from 'vite';

const root = process.cwd();
const gameRoot = path.resolve(root, 'src/games').toLowerCase();
const isGame = file => path.resolve(file).toLowerCase().startsWith(gameRoot + path.sep);
const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json', ts.sys.readFile).config, ts.sys, root);
const host = ts.createCompilerHost(parsed.options);
const getSourceFile = host.getSourceFile.bind(host);
host.fileExists = file => !isGame(file) && ts.sys.fileExists(file);
host.readFile = file => isGame(file) ? undefined : ts.sys.readFile(file);
host.directoryExists = file => !isGame(file) && ts.sys.directoryExists(file);
host.getSourceFile = (file, ...args) => isGame(file) ? undefined : getSourceFile(file, ...args);
// Ambient browser and host declarations must be present even in a narrow program.
const roots = ['src/main.ts', 'src/vite-env.d.ts', 'src/node-sqlite.d.ts', 'src/ktx2decoder.d.ts',
  'src/engine/core/DebugGlobals.ts', 'src/electron/preload.ts'];
const program = ts.createProgram(roots, parsed.options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n',
  }));
  process.exit(1);
}
if (program.getSourceFiles().some(file => isGame(file.fileName))) throw new Error('Game source entered engine types');
console.log('Engine browser types: zero diagnostics with games hidden');
process.env.SHAG_APP = 'engine';
await build({
  root,
  build: { outDir: '.cache/browser-engine-check', emptyOutDir: true, copyPublicDir: false },
  plugins: [{
    name: 'check-engine-browser-boundary',
    generateBundle() {
      const gameFiles = [...this.getModuleIds()].filter(id => id.replaceAll('\\', '/').includes('/src/games/'));
      if (gameFiles.length) throw new Error(`Game source entered engine bundle: ${gameFiles.join(', ')}`);
      console.log('Engine browser bundle: zero game modules');
    },
  }],
});
