/**
 * Post-install fixups for native/wasm artifacts that must live in specific
 * places (npm installs/rebuilds re-create these dirs and lose the copies):
 *
 * 1. Havok physics wasm → public/wasm/ (served to the browser).
 * 2. tfjs-node's tensorflow.dll → next to the napi addon. On Windows the
 *    prebuilt binding loads tensorflow.dll from its own directory; npm leaves
 *    the DLL only in deps/lib (and sometimes a different napi-vN dir), which
 *    breaks require("@tensorflow/tfjs-node") with "specified module not found"
 *    (seen as: HybridBrain save/load test failing with "no save handlers").
 */

import fs from "node:fs";
import path from "node:path";

function copyIfExists(src, dest, label) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[postinstall] Copied ${label} -> ${dest}`);
  return true;
}

// 1. Havok wasm for the browser.
copyIfExists(
  "node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",
  "public/wasm/HavokPhysics.wasm",
  "HavokPhysics.wasm",
);

// 2. tensorflow.dll beside every napi addon dir that ships tfjs_binding.node.
const tfRoot = "node_modules/@tensorflow/tfjs-node";
const tfDll = path.join(tfRoot, "deps/lib/tensorflow.dll");
const libRoot = path.join(tfRoot, "lib");
if (fs.existsSync(tfDll) && fs.existsSync(libRoot)) {
  for (const dir of fs.readdirSync(libRoot)) {
    const addonDir = path.join(libRoot, dir);
    if (!fs.statSync(addonDir).isDirectory()) continue;
    if (!fs.existsSync(path.join(addonDir, "tfjs_binding.node"))) continue;
    if (fs.existsSync(path.join(addonDir, "tensorflow.dll"))) continue;
    copyIfExists(tfDll, path.join(addonDir, "tensorflow.dll"), "tensorflow.dll");
  }
}
