/**
 * Instances of the compiled world trace's module (CompiledWorldTrace) in the
 * browser: WorldTrace.wasm shipped as an asset, fetched and compiled once,
 * off the main thread's synchronous limits, and instantiated per map.
 * MapLoader hands one to the collision manager once a map's collision is up;
 * until then, and wherever this fails, the backend traces in TypeScript with
 * the same answers.
 */

import wasmUrl from "./WorldTrace.wasm?url";

let compiling: Promise<WebAssembly.Module | null> | null = null;

/** A fresh instance of the module, for one map, or null when it will not load here. */
export async function instantiateWorldTrace(): Promise<WebAssembly.Instance | null> {
  compiling ??= fetch(wasmUrl)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`${response.status}`))))
    .then((bytes) => WebAssembly.compile(bytes))
    .catch(() => null);
  const module = await compiling;
  if (!module) return null;
  try {
    return await WebAssembly.instantiate(module, {});
  } catch {
    return null;
  }
}
