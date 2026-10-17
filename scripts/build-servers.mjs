import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  absWorkingDir: root,
  entryPoints: ["src/cli/headless-netserver-v2.ts", "src/cli/lobby-server.ts", "src/cli/ServerBenchmarkClient.ts", "src/cli/ServerRuntimeProbe.ts"],
  outdir: process.argv[2] ?? "dist-server",
  outExtension: { ".js": ".mjs" },
  bundle: true, platform: "node", target: "node24", format: "esm",
  external: ["ws"], tsconfig: "tsconfig.json", sourcemap: "external", metafile: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
}).then(async (result) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.resolve(root, process.argv[2] ?? "dist-server", "meta.json"), JSON.stringify(result.metafile, null, 2));
});
