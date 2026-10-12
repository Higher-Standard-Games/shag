#!/usr/bin/env node
/** Run the TypeScript generator through the project's local runtime, without npm or a shell. */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [
  resolve(root, 'node_modules/vite-node/vite-node.mjs'),
  resolve(root, 'src/cli/generate-pk3-index.ts'), '--', ...process.argv.slice(2),
], { cwd: root, stdio: 'inherit', shell: false });
if (result.error) console.error(`[pk3-index] ${result.error.message}`);
process.exitCode = result.status ?? 1;
