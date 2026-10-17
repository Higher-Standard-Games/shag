import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  process.execPath,
  [
    resolve(root, "node_modules/vite-node/vite-node.mjs"),
    resolve(root, "src/cli/package-map-media.ts"),
    "--",
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: "inherit", shell: false },
);
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
