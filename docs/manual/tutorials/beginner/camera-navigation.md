# Camera navigation

## Freefly

```text
developer 1
camera mode freefly
freefly_speed 300
```

`camera` and `freefly_collision` work without developer mode; `freefly_speed` and `teleport` do not.

After clicking the canvas:

| Input | Action |
| --- | --- |
| WASD | move |
| Mouse | look |
| Space | move up |
| C, Ctrl or middle mouse | move down |
| Shift | speed multiplier |
| Escape | release pointer lock |

These are the Jump, Crouch and Sprint actions, so they follow whatever those are bound to in Settings → Controls.

The scroll wheel selects weapons in FPS play and does not change freefly speed; use `freefly_speed <positive-number>`.

## Collision

```text
freefly_collision
freefly_collision 0
freefly_collision 1
freefly_collision mode bsp
freefly_collision test
```

The no-argument form reports the current state. The BSP mode requires loaded collision data; native mode uses Babylon mesh collision.

## Other controllers

```text
camera mode fps
camera mode isometric
camera mode sidescroll
camera mode follow
```

`camera mode` selects a registered controller. Projection (perspective or orthographic) is set in code through `CameraSystem.applyCameraMode`; it has no console command.

## Position and teleport

```text
pos
pos copy
teleport 0 128 0
```

`teleport` (aliases `tp`, `goto`) requires developer mode.

## Useful inspection

```text
camera info
camera fov 100
bsp entities info_player_deathmatch details
```
