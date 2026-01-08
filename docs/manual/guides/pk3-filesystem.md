# PK3 Virtual Filesystem

How SHAG Engine handles PK3 archives and file loading.

## Overview

PK3 files are ZIP archives used by Quake 3 and Warsow for packaging game assets. SHAG Engine provides a virtual filesystem that:

- Loads multiple PK3 archives
- Resolves file paths across all archives
- Handles priority/override system
- Provides lazy file extraction

## Architecture

```
PK3Loader (Singleton)
    │
    ├── archives: Map<name, ZipArchive>
    ├── fileIndex: Map<path, { pk3, priority }>
    │
    └── getFile(path) → ArrayBuffer | null
```

## Using PK3Loader

```typescript
import { PK3Loader } from './engine/loader/pk3/PK3Loader';

const pk3 = PK3Loader.getInstance();

// Index all PK3s in directory
await pk3.indexDirectory('./public/game');

// Load specific PK3
await pk3.loadPK3('./mods/custom.pk3', 100); // priority 100

// Get file
const data = await pk3.getFile('maps/wdm7.bsp');

// Check file exists
const exists = await pk3.hasFile('textures/wall.tga');

// List files
const maps = pk3.listFiles('maps/');
const textures = pk3.listFiles('textures/base/');
```

## Priority System

When multiple PK3s contain the same file, priority determines which is used:

```
data0_15pure.pk3    (priority 0)   ← Base assets
tex_custom.pk3      (priority 50)  ← Override
my_mod.pk3          (priority 100) ← Wins
```

Higher priority overrides lower.

### Priority from Filename

PK3 files with numbers in the name get automatic priority:

```
data0_15.pk3     → priority 16 (from "15")
modules_15_001   → priority 2 (from "001")
tex_36.pk3       → priority 37 (from "36")
```

### Manual Priority

```typescript
await pk3.loadPK3('./mod.pk3', 999); // Very high priority
```

## File Index

After indexing, PK3Loader maintains a map of all files:

```typescript
// Internal structure
fileIndex = {
  'maps/wdm7.bsp': { pk3: 'map_wdm7.pk3', priority: 0 },
  'textures/wall.tga': { pk3: 'tex_base.pk3', priority: 0 },
  // ...
};
```

## Console Commands

```
pk3 list                 # List all loaded PK3s
pk3 list maps/           # List files in path
pk3 list textures/base/  # Filter by directory
pk3 info map_wdm7.pk3    # Show PK3 details
```

## Lazy Loading

Files are extracted on demand, not at index time:

```typescript
// Indexing is fast - just reads ZIP directory
await pk3.indexDirectory('./game'); // Fast

// Extraction happens on getFile()
const data = await pk3.getFile('maps/wdm7.bsp'); // Extracts now
```

## Path Resolution

Paths are normalized:

```typescript
// All equivalent
pk3.getFile('maps/wdm7.bsp');
pk3.getFile('Maps/WDM7.BSP');  // Case insensitive
pk3.getFile('/maps/wdm7.bsp'); // Leading slash stripped
```

## Supported Archives

- `.pk3` - Standard Quake 3 / Warsow
- `.zip` - Also supported (same format)

## Memory Management

Large files are loaded on demand. For frequently accessed files, consider caching:

```typescript
class AssetCache {
  private cache = new Map<string, ArrayBuffer>();
  
  async get(path: string): Promise<ArrayBuffer | null> {
    if (this.cache.has(path)) {
      return this.cache.get(path)!;
    }
    
    const data = await pk3.getFile(path);
    if (data) {
      this.cache.set(path, data);
    }
    return data;
  }
}
```

## Error Handling

```typescript
const data = await pk3.getFile('missing/file.txt');
if (!data) {
  console.warn('File not found');
}
```

## Related

- [Tutorial: Working with PK3 Mods](../tutorials/intermediate/pk3-mods.md)
- [Guide: BSP System](./bsp-system.md)
