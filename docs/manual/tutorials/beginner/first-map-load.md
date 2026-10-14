# Your first map load

This tutorial verifies that an indexed Q3/Warsow BSP can be found, parsed, and inspected.

## 1. Start the browser client

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), press backquote/tilde, and enable developer commands:

```text
developer 1
```

F1 is not a default console binding.

## 2. Load and render an inspection map

```text
bsp load wdm2
bsp render
bsp info
```

`bsp load` parses the map. `bsp render` creates the scene geometry in this lower-level inspection flow.

Optional material/sky commands:

```text
bsp loadrequired
shader load
bsp applytextures
bsp applylightmaps
bsp sky apply
```

Use `help bsp` if a dependency or scene prerequisite is missing.

## 3. Explore

```text
camera mode freefly
freefly_speed 300
```

Click the canvas for pointer lock. Use WASD and mouse look; Space moves up, C or Ctrl moves down, and Shift increases speed.

## 4. Inspect

```text
bsp entities
bsp textures
bsp faces
bsp worldspawn
shader info
```

`shader info` without a name inspects the surface under the crosshair in a browser scene.

## Gameplay is a separate flow

```text
map wdm2 duel
```

`map` uses the gameplay/lobby launcher and starts the full server-backed FPS flow. See [Map launching](../../guides/map-launching.md).

## Headless equivalent

```bash
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
```

## Troubleshooting

- Run `npm run tools:manifest` after adding a PK3.
- Use `pk3 stats` and `pk3 find maps/wdm2.bsp` to check discovery.
- Use `render list` for current renderer variables; changes apply immediately.
