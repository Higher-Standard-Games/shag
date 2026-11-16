/**
 * The compiled world trace's module (CompiledWorldTrace), read off disk in
 * Node: WorldTrace.wasm beside this file when run from source, or beside the
 * bundle that holds it (build-servers.mjs copies it there). Null when it is
 * not there; the backend then traces in TypeScript.
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = "WorldTrace.wasm";
let cached: Uint8Array<ArrayBuffer> | null | undefined;

export function worldTraceWasm(): Uint8Array<ArrayBuffer> | null {
  if (cached !== undefined) return cached;
  try {
    const file = fileURLToPath(new URL(`./${FILE}`, import.meta.url));
    cached = fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
  } catch {
    cached = null;
  }
  return cached;
}
