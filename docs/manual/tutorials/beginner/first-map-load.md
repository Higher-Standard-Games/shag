# Your First Map Load

**Time:** 10 minutes  
**Level:** Beginner

Learn how to load a Quake 3/Warsow map and explore it.

## Prerequisites

- SHAG Engine [installed and running](../../getting-started/)
- Development server started (`npm run dev`)

## Step 1: Open the Console

Press **`~`** (tilde) or **`F1`** to open the console.

You should see a command prompt:

```
> _
```

## Step 2: Load a Map

Type the following command and press Enter:

```
map wdm7
```

You'll see loading progress:

```
[MapLoader] Loading map: wdm7
[PK3Loader] Found BSP: maps/wdm7.bsp
[BspLoader] Parsed 12,456 vertices, 8,234 faces
[MapLoader] Map loaded successfully
```

## Step 3: Explore the Map

The camera spawns at a player spawn point. Use these controls:

| Key | Action |
|-----|--------|
| **W/A/S/D** | Move forward/left/back/right |
| **Mouse** | Look around |
| **Space** | Move up |
| **Shift** | Move down |
| **Scroll** | Adjust speed |

## Step 4: Try Other Maps

SHAG Engine includes many Warsow maps:

```
map wdm2
map wdm11
map wctf1
```

## Step 5: Get Map Info

Open console and type:

```
bsp info
```

You'll see map statistics:

```
Format: FBSP
Vertices: 12,456
Faces: 8,234
Textures: 89
Entities: 42
```

## What's Happening?

When you type `map wdm7`:

1. **PK3Loader** finds `maps/wdm7.bsp` in the archives
2. **BspLoader** parses the binary BSP format
3. **BspMeshBuilder** creates Babylon.js geometry
4. **Q3ShaderRegistry** applies materials
5. **SkyboxLoader** creates the sky
6. **CameraSystem** spawns at `info_player_deathmatch`

## Troubleshooting

**Map not found?**
```
pk3 list maps/
```
Shows available maps in loaded archives.

**Black screen?**
Check console for errors. Try:
```
r_lightmap 1
r_apply
```

## Next Steps

- [Navigating with the Camera](./camera-navigation.md)
- [Using the Console](./using-console.md)
