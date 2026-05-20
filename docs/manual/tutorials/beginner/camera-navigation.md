# Navigating with the Camera

**Time:** 5 minutes  
**Level:** Beginner

Learn camera controls for exploring maps.

## Prerequisites

- [First Map Load](./first-map-load.md) completed
- A map loaded in the engine

## Freefly Controls

The default camera uses freefly mode (FPS-style):

| Key | Action |
|-----|--------|
| **W** | Move forward |
| **S** | Move backward |
| **A** | Strafe left |
| **D** | Strafe right |
| **Space** | Move up |
| **Shift** | Move down |
| **Mouse** | Look around |
| **Scroll** | Adjust speed |

## Adjusting Speed

### Via Scroll Wheel

Scroll up to increase speed, scroll down to decrease.

### Via Console

```
freefly_speed 2.0
```

Values: `0.1` (slow) to `10.0` (very fast)

## Collision Detection

By default, collision is enabled. Toggle with:

```
freefly_collision 0    # Disable (noclip)
freefly_collision 1    # Enable
```

With collision disabled, you can fly through walls.

## Switching Camera Modes

### Isometric View

Top-down camera for strategy games:

```
camera controller isometric
```

Controls:
- WASD or edge scroll to pan
- Scroll to zoom

### Sidescroll View

2.5D platformer camera:

```
camera controller sidescroll
```

### Back to Freefly

```
camera controller freefly
```

## Adjusting Camera Height

For isometric/sidescroll modes:

```
camera height 800
```

## Projection Modes

```
camera mode perspective     # 3D perspective (default)
camera mode orthographic    # True orthographic
```

## Teleporting to Position

```
camera target 0 100 0
```

Moves camera to coordinates (x, y, z).

## Finding Spawn Points

To see where players spawn:

```
bsp entities
```

Look for `info_player_deathmatch` entries.

## Tips

- **Stuck?** Try `freefly_collision 0` to escape
- **Too dark?** Use `r_lightmap 2` to brighten
- **Lost?** Load a different map for inspection with `bsp load wdm2` (see the [first-map-load tutorial](./first-map-load.md) for why `bsp load` vs `map`)

## Next Steps

- [Using the Console](./using-console.md)
- [Tweaking Render Variables](./render-variables.md)
