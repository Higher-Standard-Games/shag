// A private Vite dev server for browser probes: no HMR and no file watching, so
// edits by other agents never reload the page mid-measurement.
//
//   node .claude/skills/browser-probe/scripts/private-vite.mjs [port]
//
// Run it in the background. With watching off it serves the code as it was at
// start: restart it after editing source.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const port = Number(process.argv[2] ?? 3100);
const { createServer } = await import(pathToFileURL(path.join(root, "node_modules/vite/dist/node/index.js")).href);

const server = await createServer({
  configFile: path.join(root, "vite.config.ts"),
  root,
  // The cache must stay inside the repository: one outside it breaks Babylon's
  // lazy shader imports, which Vite serves through /@fs.
  cacheDir: path.join(root, "node_modules/.vite-probe"),
  server: { port, strictPort: true, host: "127.0.0.1", hmr: false, watch: null },
});
await server.listen();
console.log(`probe server listening on http://127.0.0.1:${port}/`);
