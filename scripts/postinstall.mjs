/**
 * Post-install fixup for an artifact that must live in a specific place (npm
 * installs and rebuilds re-create the directory and lose the copy): Havok
 * physics wasm → public/wasm/, served to the browser.
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

copyIfExists(
  "node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",
  "public/wasm/HavokPhysics.wasm",
  "HavokPhysics.wasm",
);

