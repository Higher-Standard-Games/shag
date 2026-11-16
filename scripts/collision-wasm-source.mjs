/**
 * The hash of the compiled world trace's Rust source (its Cargo.toml and
 * src/), as build-collision-wasm.mjs records it beside the built module and
 * the engine's test checks it: a changed source with the old module fails.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function worldTraceSourceHash(root) {
  const crate = path.join(root, "native/collision-wasm");
  const hash = createHash("sha256");
  const files = ["Cargo.toml", ...readdirSync(path.join(crate, "src")).sort().map((f) => `src/${f}`)];
  for (const file of files) {
    hash.update(`${file}\0`);
    // Line endings as committed, whatever the checkout turned them into
    hash.update(readFileSync(path.join(crate, file), "utf8").replace(/\r\n/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
}
