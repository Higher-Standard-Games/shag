# Working with PK3 Mods

**Time:** 20 minutes  
**Level:** Intermediate

Load custom asset packs and manage mod priority.

## What Are PK3 Files?

PK3 files are ZIP archives containing game assets:
- Maps (`.bsp`)
- Textures (`.tga`, `.jpg`, `.png`)
- Shaders (`.shader`)
- Models (`.md3`)
- Sounds (`.wav`, `.ogg`)

## PK3 Priority System

SHAG Engine loads PK3s with priority ordering. Higher priority overrides lower:

```
tex_custom.pk3     (priority 100) ← Wins for conflicts
tex_factory.pk3    (priority 0)
data0_15pure.pk3   (priority 0)
```

## Loading Custom PK3s

### Method 1: Place in Game Directory

```
public/game/
├── data0_15pure.pk3     # Base assets
├── map_wdm7.pk3         # Map
└── my_custom_mod.pk3    # Your mod (auto-loaded)
```

All PK3s in the game directory are automatically indexed.

### Method 2: Load Programmatically

```typescript
const pk3 = PK3Loader.getInstance();

// Index base directory
await pk3.indexDirectory('./game');

// Load additional PK3 with high priority
await pk3.loadPK3('./mods/custom_textures.pk3', 100);
```

## Creating a PK3 Mod

### Step 1: Create Directory Structure

```
my_mod/
├── textures/
│   └── my_textures/
│       ├── wall01.tga
│       └── floor01.tga
├── scripts/
│   └── my_mod.shader
└── maps/
    └── my_map.bsp
```

### Step 2: Create Shader File

```
// scripts/my_mod.shader

textures/my_textures/wall01
{
    {
        map textures/my_textures/wall01.tga
    }
    {
        map $lightmap
        blendFunc GL_DST_COLOR GL_ZERO
    }
}
```

### Step 3: Package as ZIP

```bash
cd my_mod
zip -r ../my_mod.pk3 *
```

Or use any ZIP tool, then rename `.zip` to `.pk3`.

## Overriding Base Assets

To replace a base texture, use the same path:

```
my_override.pk3/
└── textures/
    └── base_wall/
        └── concrete.tga    # Replaces original
```

Load with higher priority:

```typescript
await pk3.loadPK3('./mods/my_override.pk3', 50);
```

## Checking Loaded Assets

```typescript
const pk3 = PK3Loader.getInstance();

// List all loaded PK3s
console.log('Loaded PK3s:', pk3.getLoadedArchives());

// List files in a path
const textures = pk3.listFiles('textures/');
console.log('Textures:', textures);

// Check if file exists
const exists = await pk3.hasFile('textures/my_mod/wall01.tga');
```

Console commands:

```
pk3 list                    # All PK3s
pk3 list textures/          # Files in path
pk3 list maps/              # Available maps
```

## Reload Shaders After Loading PK3

After loading a new PK3 with shaders:

```typescript
const shaders = Q3ShaderRegistry.getInstance();
await shaders.loadFromPK3(); // Loads new shaders
```

Console:

```
shader load
shader count
```

## Best Practices

1. **Use unique paths** - Avoid conflicts with base assets
2. **Test priority** - Higher priority wins
3. **Keep mods small** - Split large mods into multiple PK3s
4. **Document dependencies** - List required base PK3s
5. **Use descriptive names** - `tex_my_mod.pk3` not `mod.pk3`

## Troubleshooting

### Textures not appearing

```
shader info textures/my_mod/wall01
pk3 list textures/my_mod/
```

### Wrong texture version loading

Check priority:
```typescript
pk3.loadPK3('./mods/fix.pk3', 999); // Very high priority
```

### Shader not found

Ensure shader file is in `scripts/` directory and reload:
```
shader load
shader list my_mod
```

## Next Steps

- [Custom Shader Materials](../advanced/custom-shaders.md)
- [Guide: PK3 Filesystem](../../guides/pk3-filesystem.md)
