/**
 * Instances of the compiled world trace's module (CompiledWorldTrace) in
 * Node: WorldTrace.wasm read off disk beside this file when run from source,
 * or beside the bundle that holds it (build-servers.mjs copies it there),
 * compiled once. Null when it is not there; the backend then traces in
 * TypeScript. The browser has its own (WorldTraceWasmBrowser.ts).
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = "WorldTrace.wasm";
let compiled: WebAssembly.Module | null | undefined;

/**
 * A fresh instance of the module, for one map, or null without the module or
 * when an instance cannot be made (its memory refused on a host short of it).
 */
export function worldTraceInstance(): WebAssembly.Instance | null {
  if (compiled === undefined) {
    try {
      const file = fileURLToPath(new URL(`./${FILE}`, import.meta.url));
      compiled = fs.existsSync(file) ? new WebAssembly.Module(new Uint8Array(fs.readFileSync(file))) : null;
    } catch {
      compiled = null;
    }
  }
  if (!compiled) return null;
  try {
    return new WebAssembly.Instance(compiled, {});
  } catch (error) {
    console.warn(`[WorldTraceWasm] No instance, tracing in TypeScript: ${String(error)}`);
    return null;
  }
}
