/**
 * Build the compiled world trace (native/collision-wasm) and put it where the
 * engine reads it: src/engine/physics/WorldTrace.wasm, with
 * WorldTrace.wasm.source holding a hash of the Rust source it was built from.
 * Needs Rust with the wasm32-unknown-unknown target; the built module is
 * committed, so nothing else needs cargo.
 *
 *   npm run build:collision-wasm
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { worldTraceSourceHash } from "./collision-wasm-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const crate = path.join(root, "native/collision-wasm");
execFileSync("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown"], { cwd: crate, stdio: "inherit" });
const built = path.join(crate, "target/wasm32-unknown-unknown/release/collision_wasm.wasm");
const target = path.join(root, "src/engine/physics/WorldTrace.wasm");
copyFileSync(built, target);
writeFileSync(`${target}.source`, `${worldTraceSourceHash(root)}\n`);
console.log(`[build-collision-wasm] ${path.relative(root, target)} from ${path.relative(root, crate)}`);
