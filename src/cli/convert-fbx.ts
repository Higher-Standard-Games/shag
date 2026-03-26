/**
 * FBX → GLB Converter CLI
 *
 * One-command FBX to GLB conversion using the project's FBX2glTF tool.
 * Auto-downloads the tool if not installed.
 *
 * Usage:
 *   npm run tools:convert -- slide.fbx                         # single file
 *   npm run tools:convert -- public/games/default/animations   # whole folder
 *   npm run tools:convert -- *.fbx                             # glob
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { basename, dirname, extname, join } from "path";

const TOOL_DIR = join(process.cwd(), "tools");
const FBX2GLTF_EXE = join(TOOL_DIR, "FBX2glTF-windows-x86_64", "FBX2glTF-windows-x86_64.exe");

function ensureToolInstalled(): void {
  if (existsSync(FBX2GLTF_EXE)) return;

  console.log("[convert] FBX2glTF not found, downloading...");
  try {
    execSync("npx vite-node scripts/download-fbx2gltf.ts", {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  } catch {
    console.error("[convert] Failed to download FBX2glTF. Run: npm run tools:fbx2gltf");
    process.exit(1);
  }

  if (!existsSync(FBX2GLTF_EXE)) {
    console.error("[convert] FBX2glTF still not found after download.");
    process.exit(1);
  }
}

function convertFile(fbxPath: string): boolean {
  const dir = dirname(fbxPath);
  const name = basename(fbxPath, extname(fbxPath));
  const outPath = join(dir, name);

  try {
    execSync(`"${FBX2GLTF_EXE}" --binary --input "${fbxPath}" --output "${outPath}"`, {
      stdio: "pipe",
    });
    const glbPath = outPath + ".glb";
    if (existsSync(glbPath)) {
      const size = statSync(glbPath).size;
      console.log(`  ✅ ${basename(fbxPath)} → ${basename(glbPath)} (${(size / 1024).toFixed(1)} KB)`);
      return true;
    }
    console.log(`  ❌ ${basename(fbxPath)} — output not found`);
    return false;
  } catch (err) {
    console.log(`  ❌ ${basename(fbxPath)} — ${(err as Error).message?.split("\n")[0]}`);
    return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
FBX → GLB Converter

Usage:
  npm run tools:convert -- <file.fbx>       Convert a single FBX file
  npm run tools:convert -- <directory>       Convert all FBX files in directory
  npm run tools:convert -- --all            Convert all FBX in animations folder

Examples:
  npm run tools:convert -- slide.fbx
  npm run tools:convert -- public/games/default/animations
  npm run tools:convert -- --all
`);
    process.exit(0);
  }

  ensureToolInstalled();

  let files: string[] = [];

  if (args[0] === "--all") {
    const animDir = join(process.cwd(), "public", "games", "default", "animations");
    if (!existsSync(animDir)) {
      console.error(`[convert] Animation directory not found: ${animDir}`);
      process.exit(1);
    }
    files = readdirSync(animDir)
      .filter((f) => f.toLowerCase().endsWith(".fbx"))
      .map((f) => join(animDir, f));
  } else {
    for (const arg of args) {
      if (existsSync(arg) && statSync(arg).isDirectory()) {
        // Directory: convert all FBX inside
        const dirFiles = readdirSync(arg)
          .filter((f) => f.toLowerCase().endsWith(".fbx"))
          .map((f) => join(arg, f));
        files.push(...dirFiles);
      } else if (existsSync(arg) && arg.toLowerCase().endsWith(".fbx")) {
        files.push(arg);
      } else {
        console.warn(`[convert] Skipping: ${arg} (not found or not .fbx)`);
      }
    }
  }

  if (files.length === 0) {
    console.log("[convert] No FBX files found.");
    process.exit(0);
  }

  console.log(`\n[convert] Converting ${files.length} FBX file(s)...\n`);

  let success = 0;
  let failed = 0;
  for (const file of files) {
    if (convertFile(file)) {
      success++;
    } else {
      failed++;
    }
  }

  console.log(`\n[convert] Done: ${success} converted, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[convert] Fatal:", err);
  process.exit(1);
});
