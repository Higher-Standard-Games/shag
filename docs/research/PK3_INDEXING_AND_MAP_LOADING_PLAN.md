# v0.8.6 - PK3 Indexing & Map Loading Improvements

**Target:** Streamline PK3 loading and make map loading work like Quake/Warsow.

---

## 1. PK3 Indexing at Engine Load

### Problem
Currently, PK3 files are loaded on-demand, which causes:
- Slow initial texture/shader loading
- Need to manually run `pk3 load` commands
- No knowledge of what's available until loaded

### Solution
Index all PK3 files at engine startup:

```typescript
interface PK3Index {
  // Checksum of pk3 file list (names + sizes + dates)
  listChecksum: string;
  
  // Map: filename -> pk3 path
  // e.g., "textures/boqu/lightstripe_blue.tga" -> "tex_boqu.pk3"
  fileIndex: Map<string, string>;
  
  // Map: shader name -> pk3 path  
  shaderIndex: Map<string, string>;
  
  // Map: map name -> pk3 path
  mapIndex: Map<string, string>;
  
  // List of indexed pk3 files with metadata
  pk3Files: Array<{
    path: string;
    size: number;
    modified: number;
  }>;
}
```

### Cache Invalidation Strategy

**Simple checksum approach:**
```typescript
function computePK3ListChecksum(pk3Dir: string): string {
  const files = listPK3Files(pk3Dir);
  // Sort for consistency
  files.sort((a, b) => a.path.localeCompare(b.path));
  
  // Build checksum string: "filename:size:mtime|filename:size:mtime|..."
  const checksumInput = files
    .map(f => `${f.name}:${f.size}:${f.mtime}`)
    .join('|');
  
  return simpleHash(checksumInput); // CRC32 or similar
}
```

**Cache location:** `localStorage` or `.pk3index.json` in assets folder

**On engine load:**
```typescript
async function initPK3Index(): Promise<void> {
  const currentChecksum = computePK3ListChecksum(pk3Dir);
  const cached = loadCachedIndex();
  
  if (cached && cached.listChecksum === currentChecksum) {
    // Use cached index
    pk3Index = cached;
    console.log('[PK3Index] Using cached index');
  } else {
    // Rebuild index
    console.log('[PK3Index] Rebuilding index...');
    pk3Index = await buildPK3Index(pk3Dir);
    saveCachedIndex(pk3Index);
  }
}
```

---

## 2. Auto-Detect Required PK3s from Shader References

### Problem
BSP references shader in `pk3_X`, but shader references textures in `pk3_Y`.
Currently requires manual `pk3 load` for each dependency.

### Solution
Use the PK3 index to resolve dependencies:

```typescript
async function loadMapWithDependencies(mapName: string): Promise<void> {
  // 1. Find which PK3 contains the BSP
  const mapPk3 = pk3Index.mapIndex.get(`maps/${mapName}.bsp`);
  if (!mapPk3) throw new Error(`Map not found: ${mapName}`);
  
  // 2. Load the BSP and get shader references
  const bsp = await loadBsp(mapPk3, mapName);
  const shaderNames = bsp.getReferencedShaders();
  
  // 3. For each shader, find its PK3 and load shader definitions
  const requiredPk3s = new Set<string>();
  requiredPk3s.add(mapPk3);
  
  for (const shaderName of shaderNames) {
    // Find shader definition PK3
    const shaderPk3 = pk3Index.shaderIndex.get(shaderName);
    if (shaderPk3) requiredPk3s.add(shaderPk3);
    
    // Parse shader to find texture references
    const shader = shaderRegistry.getShader(shaderName);
    if (shader) {
      for (const stage of shader.stages) {
        if (stage.map && !stage.map.startsWith('$')) {
          // Find texture PK3
          const texPk3 = pk3Index.fileIndex.get(stage.map);
          if (texPk3) requiredPk3s.add(texPk3);
        }
      }
    }
  }
  
  // 4. Load all required PK3s
  for (const pk3 of requiredPk3s) {
    await pk3Loader.loadPk3(pk3);
  }
}
```

### Index Building - What to Index

When building the index, scan each PK3 for:

| Content Type | Index Key | Example |
|--------------|-----------|---------|
| Maps | `maps/*.bsp` | `maps/wdm1.bsp` |
| Shaders | Shader names from `.shader` files | `textures/boqu/lightstripe_blue_800` |
| Textures | `textures/**/*` | `textures/boqu/lightstripe_blue.tga` |
| Models | `models/**/*` | `models/mapobjects/lamp/lamp.md3` |
| Sounds | `sound/**/*` | `sound/weapons/rocket_fire.wav` |
| Env/Sky | `env/**/*` | `env/stormydays/stormydays_ft.tga` |

---

## 3. Unified Map Command

### Current Behavior
- `map <name>` loads `.map` files from local filesystem
- BSP maps require manual: `bsp load`, `shader load`, `bsp render`, etc.

### Proposed Behavior
```
map <name>          - Auto-detect and load map (local .map or PK3 .bsp)
map list            - List all available maps (local + PK3)
map reload          - Reload current map
```

### Detection Logic
```typescript
async function loadMap(mapName: string): Promise<void> {
  // 1. Check for local .map file
  const localMapPath = `assets/maps/${mapName}.map`;
  if (await fileExists(localMapPath)) {
    return loadLocalMap(localMapPath);
  }
  
  // 2. Check PK3 index for BSP
  const bspPath = `maps/${mapName}.bsp`;
  const pk3 = pk3Index.mapIndex.get(bspPath);
  if (pk3) {
    return loadBspMap(mapName);
  }
  
  // 3. Not found
  throw new Error(`Map not found: ${mapName}`);
}
```

### BSP Map Loading Sequence
Encapsulate the current manual sequence:

```typescript
async function loadBspMap(mapName: string): Promise<void> {
  console.log(`[MapLoader] Loading BSP map: ${mapName}`);
  
  // 1. Clear scene
  await executeCommand('scene empty');
  
  // 2. Load BSP
  await executeCommand(`bsp load ${mapName}`);
  
  // 3. Auto-load required PK3s (using dependency detection)
  await executeCommand('bsp loadrequired');
  
  // 4. Load shaders
  await executeCommand('shader load');
  
  // 5. Render BSP geometry
  await executeCommand('bsp render');
  
  // 6. Apply textures
  await executeCommand('bsp applytextures');
  
  // 7. Apply skybox
  await executeCommand('bsp sky apply');
  
  // 8. Apply lightmaps
  await executeCommand('bsp applylightmaps');
  
  console.log(`[MapLoader] Map loaded: ${mapName}`);
}
```

### Map List Command
```typescript
function listMaps(): string[] {
  const maps: string[] = [];
  
  // Local .map files
  for (const file of listLocalMaps()) {
    maps.push(`${file.name} (local)`);
  }
  
  // PK3 BSP maps
  for (const [bspPath, pk3] of pk3Index.mapIndex) {
    const name = bspPath.replace('maps/', '').replace('.bsp', '');
    maps.push(`${name} (${pk3})`);
  }
  
  return maps.sort();
}
```

---

## 4. Additional Improvements to Consider

### 4.1 PK3 Load Progress
Show progress during indexing:
```
[PK3Index] Indexing 24 PK3 files...
[PK3Index] [1/24] tex_base.pk3 (2,341 files)
[PK3Index] [2/24] tex_boqu.pk3 (156 files)
...
[PK3Index] Complete: 45,231 files indexed in 2.3s
```

### 4.2 Lazy PK3 Content Loading
Index only metadata at startup, load actual content on-demand:
- **Index phase:** Scan ZIP central directories (fast, ~100ms for 24 PK3s)
- **Load phase:** Extract files when needed

### 4.3 Missing Asset Detection
After loading a map, report missing assets:
```
[MapLoader] Missing assets:
  - textures/custom/missing_tex.tga (not in any PK3)
  - models/mapobjects/custom/item.md3 (not in any PK3)
```

### 4.4 PK3 Search Path Priority
Allow priority ordering for overlapping content:
```typescript
const pk3Priority = [
  'basewsw/*.pk3',      // Base Warsow (lowest)
  'custom/*.pk3',       // Custom content
  'override/*.pk3',     // Override (highest)
];
```

### 4.5 Console Command Improvements
```
pk3 index           - Rebuild PK3 index
pk3 index status    - Show index stats
pk3 find <pattern>  - Search indexed files
pk3 deps <mapname>  - Show map dependencies
```

### 4.6 Map Hotloading
Watch for .map file changes and auto-reload during development.

### 4.7 Recent Maps List
Track recently loaded maps for quick access:
```
map recent          - Show last 10 maps
map 1               - Load first recent map
```

---

## 5. Implementation Order

| Phase | Task | Effort |
|-------|------|--------|
| 1 | PK3 index data structure | 30m |
| 2 | Index building (scan PK3 central dirs) | 1h |
| 3 | Cache save/load with checksum | 30m |
| 4 | Shader name extraction from .shader files | 1h |
| 5 | Dependency resolution | 1h |
| 6 | Unified `map` command | 1h |
| 7 | `map list` command | 30m |
| 8 | Console commands (`pk3 index`, `pk3 find`) | 30m |
| **Total** | | **~6h** |

---

## 6. File Structure

```
src/engine/loader/pk3/
├── PK3Index.ts           # NEW - Index data structure & cache
├── PK3IndexBuilder.ts    # NEW - Build index from PK3 files
├── PK3TextureLoader.ts   # Modify - Use index for lookups
└── index.ts              # Update exports

src/engine/loader/map/
├── MapLoader.ts          # NEW - Unified map loading
└── index.ts

src/engine/debug/
└── EngineCommands.ts     # Add new commands
```

---

## 7. Open Questions

1. **Cache location:** `localStorage` vs file system? Browser vs Electron?
2. **Index size:** Will 45k+ entries be too large for localStorage?
3. **Shader parsing during index:** Full parse or just extract names?
4. **Hot reload:** Worth implementing for v0.8.6 or defer?

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Large index size | Use compressed JSON, lazy loading |
| Slow initial indexing | Show progress, parallelize |
| Stale cache | Checksum invalidation |
| Missing dependencies | Graceful fallback, warn user |

