/**
 * Audit Textures CLI - Headless tool to find missing BSP textures
 *
 * Loads the PK3 index and compares against BSP texture references
 * to identify which textures are missing from the indexed packages.
 *
 * Usage:
 *   npx vite-node src/cli/audit-textures.ts <mapname>
 *   npx vite-node src/cli/audit-textures.ts wdm2
 *
 * Prerequisites:
 *   - public/games/default/pk3_manifest.json must exist
 *   - PK3 files must be in public/games/default/
 */

import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";
import { BspLoader, getBspUsedTextures, type BspFile } from "../engine/loader/bsp/BspLoader";

// ============================================================================
// Configuration
// ============================================================================

const GAME_PATH = "public/games/default";
const TEXTURE_EXTENSIONS = [".tga", ".jpg", ".jpeg", ".png", ".ktx", ".dds"];

// ============================================================================
// Types
// ============================================================================

interface IndexedFile {
    path: string;
    pk3: string;
}

interface AuditResult {
    mapName: string;
    totalTextures: number;
    foundTextures: number;
    missingTextures: string[];
    textureDetails: {
        texture: string;
        foundAs?: string;
        inPk3?: string;
        hasShader?: boolean;
    }[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load PK3 manifest
 */
async function loadManifest(basePath: string): Promise<string[]> {
    const manifestPath = path.join(basePath, "pk3_manifest.json");
    if (!fs.existsSync(manifestPath)) {
        console.error(`[Audit] pk3_manifest.json not found at ${manifestPath}`);
        console.error("[Audit] Run: node scripts/generate-pk3-manifest.js");
        process.exit(1);
    }

    const content = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(content);
    return Array.isArray(manifest.files) ? manifest.files : manifest;
}

/**
 * Build in-memory index of all files in PK3s
 */
async function buildIndex(basePath: string, pk3Files: string[]): Promise<Map<string, IndexedFile>> {
    const index = new Map<string, IndexedFile>();

    for (const pk3Name of pk3Files) {
        const pk3Path = path.join(basePath, pk3Name);
        if (!fs.existsSync(pk3Path)) {
            console.warn(`[Audit] PK3 not found: ${pk3Path}`);
            continue;
        }

        const data = fs.readFileSync(pk3Path);
        const zip = await JSZip.loadAsync(new Uint8Array(data));

        zip.forEach((relativePath) => {
            const normalized = relativePath.toLowerCase().replace(/\\/g, "/");
            if (!normalized.endsWith("/")) {
                index.set(normalized, { path: normalized, pk3: pk3Name });
            }
        });

        console.log(`[Audit] Indexed ${pk3Name}`);
    }

    return index;
}

/**
 * Build shader name index from .shader files
 */
async function buildShaderIndex(basePath: string, pk3Files: string[]): Promise<Set<string>> {
    const shaders = new Set<string>();

    for (const pk3Name of pk3Files) {
        const pk3Path = path.join(basePath, pk3Name);
        if (!fs.existsSync(pk3Path)) continue;

        const data = fs.readFileSync(pk3Path);
        const zip = await JSZip.loadAsync(new Uint8Array(data));

        for (const [filePath, file] of Object.entries(zip.files)) {
            const normalized = filePath.toLowerCase();
            if (normalized.endsWith(".shader") &&
                (normalized.startsWith("scripts/") || normalized.startsWith("shaders/"))) {
                try {
                    const content = await file.async("string");
                    const shaderNames = extractShaderNames(content);
                    for (const name of shaderNames) {
                        shaders.add(name.toLowerCase());
                    }
                } catch {
                    // Skip unreadable shader files
                }
            }
        }
    }

    return shaders;
}

/**
 * Extract shader names from .shader file content
 */
function extractShaderNames(content: string): string[] {
    const names: string[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed === "") continue;

        const match = trimmed.match(/^([^\s{]+)\s*\{?\s*$/);
        if (match) {
            const potentialName = match[1].toLowerCase();
            if (potentialName.includes("/") && !potentialName.startsWith("{")) {
                names.push(potentialName);
            }
        }
    }

    return names;
}

/**
 * Find BSP file in PK3s for a given map name
 */
async function findBspInPk3(basePath: string, pk3Files: string[], mapName: string): Promise<ArrayBuffer | null> {
    const bspPath = `maps/${mapName.toLowerCase()}.bsp`;

    for (const pk3Name of pk3Files) {
        const pk3Path = path.join(basePath, pk3Name);
        if (!fs.existsSync(pk3Path)) continue;

        const data = fs.readFileSync(pk3Path);
        const zip = await JSZip.loadAsync(new Uint8Array(data));

        for (const [filePath, file] of Object.entries(zip.files)) {
            if (filePath.toLowerCase() === bspPath) {
                console.log(`[Audit] Found BSP in ${pk3Name}`);
                return await file.async("arraybuffer");
            }
        }
    }

    return null;
}

/**
 * Search for a texture in the index, trying multiple extensions and prefixes
 */
function findTexture(
    textureName: string,
    fileIndex: Map<string, IndexedFile>,
    shaderIndex: Set<string>
): { found: boolean; foundAs?: string; inPk3?: string; hasShader?: boolean } {
    const baseName = textureName.toLowerCase().replace(/\.(tga|jpg|jpeg|png|ktx|dds)$/i, "");

    // Check if it's a shader
    if (shaderIndex.has(baseName)) {
        return { found: true, foundAs: baseName, hasShader: true };
    }

    // Try direct path with extensions
    for (const ext of TEXTURE_EXTENSIONS) {
        const withExt = baseName + ext;
        const entry = fileIndex.get(withExt);
        if (entry) {
            return { found: true, foundAs: withExt, inPk3: entry.pk3 };
        }
    }

    // Try with textures/ prefix
    if (!baseName.startsWith("textures/")) {
        for (const ext of TEXTURE_EXTENSIONS) {
            const prefixed = "textures/" + baseName + ext;
            const entry = fileIndex.get(prefixed);
            if (entry) {
                return { found: true, foundAs: prefixed, inPk3: entry.pk3 };
            }
        }
    }

    return { found: false };
}

/**
 * Audit a BSP's textures against the index
 */
function auditTextures(
    bsp: BspFile,
    mapName: string,
    fileIndex: Map<string, IndexedFile>,
    shaderIndex: Set<string>
): AuditResult {
    const textureNames = getBspUsedTextures(bsp);
    const details: AuditResult["textureDetails"] = [];
    const missing: string[] = [];

    for (const texName of textureNames) {
        const result = findTexture(texName, fileIndex, shaderIndex);
        details.push({
            texture: texName,
            foundAs: result.foundAs,
            inPk3: result.inPk3,
            hasShader: result.hasShader,
        });

        if (!result.found) {
            missing.push(texName);
        }
    }

    return {
        mapName,
        totalTextures: textureNames.length,
        foundTextures: textureNames.length - missing.length,
        missingTextures: missing,
        textureDetails: details,
    };
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log(`
Audit Textures CLI - Find missing BSP textures

Usage:
  npx vite-node src/cli/audit-textures.ts <mapname>

Examples:
  npx vite-node src/cli/audit-textures.ts wdm2
  npx vite-node src/cli/audit-textures.ts wdm11

Options:
  --verbose    Show all textures, not just missing ones
  --json       Output results as JSON
`);
        process.exit(1);
    }

    const mapName = args[0];
    const verbose = args.includes("--verbose");
    const jsonOutput = args.includes("--json");

    console.log(`\n=== Texture Audit: ${mapName} ===\n`);

    // 1. Load manifest
    console.log("[Audit] Loading PK3 manifest...");
    const pk3Files = await loadManifest(GAME_PATH);
    console.log(`[Audit] Found ${pk3Files.length} PK3 files\n`);

    // 2. Find BSP
    console.log(`[Audit] Searching for maps/${mapName}.bsp...`);
    const bspData = await findBspInPk3(GAME_PATH, pk3Files, mapName);

    if (!bspData) {
        console.error(`[Audit] BSP not found: maps/${mapName}.bsp`);
        console.error("[Audit] Available maps in PK3s:");
        for (const pk3Name of pk3Files) {
            if (pk3Name.toLowerCase().includes("map")) {
                console.error(`  - ${pk3Name}`);
            }
        }
        process.exit(1);
    }

    // 3. Parse BSP
    console.log("[Audit] Parsing BSP...");
    const bsp = BspLoader.load(bspData);
    console.log(`[Audit] BSP: ${bsp.header.isFBSP ? "FBSP" : "IBSP"} v${bsp.header.version}`);
    console.log(`[Audit] Textures referenced: ${bsp.textures.length}\n`);

    // 4. Build indexes
    console.log("[Audit] Building file index...");
    const fileIndex = await buildIndex(GAME_PATH, pk3Files);
    console.log(`[Audit] Indexed ${fileIndex.size} files\n`);

    console.log("[Audit] Building shader index...");
    const shaderIndex = await buildShaderIndex(GAME_PATH, pk3Files);
    console.log(`[Audit] Indexed ${shaderIndex.size} shaders\n`);

    // 5. Audit
    console.log("[Audit] Cross-referencing textures...\n");
    const result = auditTextures(bsp, mapName, fileIndex, shaderIndex);

    // 6. Output results
    if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log("=== AUDIT RESULTS ===\n");
        console.log(`Map: ${result.mapName}`);
        console.log(`Total textures: ${result.totalTextures}`);
        console.log(`Found: ${result.foundTextures} (${((result.foundTextures / result.totalTextures) * 100).toFixed(1)}%)`);
        console.log(`Missing: ${result.missingTextures.length}\n`);

        if (result.missingTextures.length > 0) {
            console.log("=== MISSING TEXTURES ===");
            for (const tex of result.missingTextures) {
                console.log(`  ✗ ${tex}`);
            }
            console.log("");
        }

        if (verbose) {
            console.log("=== ALL TEXTURES ===");
            for (const detail of result.textureDetails) {
                const status = detail.inPk3
                    ? `✓ ${detail.inPk3}`
                    : detail.hasShader
                        ? "✓ (shader)"
                        : "✗ MISSING";
                console.log(`  ${detail.texture}: ${status}`);
            }
        }
    }

    // Exit with error if there are missing textures
    if (result.missingTextures.length > 0) {
        console.log("\n[Audit] WARNING: Some textures are missing from the PK3 index!");
        console.log("[Audit] This could cause black or invisible surfaces in-game.");
        process.exit(1);
    } else {
        console.log("\n[Audit] All textures found! ✓");
    }
}

main().catch((err) => {
    console.error("[Audit] Fatal error:", err);
    process.exit(1);
});
