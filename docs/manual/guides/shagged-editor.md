# SHAGGED map editor

SHAGGED (SHAG General Editor) is the brush editor built into the engine. It opens from the game console, edits maps in four views, compiles them with MakeBSP/MakeLight and launches them for a playtest. Maps can also be built from scripts or AI agents: see the [SHAGGED scripting API](./shagged-api.md).

Design notes and status: `docs/research/SHAGGED.md` in the repository.

## Opening the editor

In the game console (from the lobby):

```text
developer 1
editor open
```

`editor close` (or the **Exit** button) saves the draft and returns to the lobby; `editor status` reports whether it is open and which draft is loaded. Leave a running match before opening the editor. The console stays available while you edit.

## The workspace

Four views of the same map: **3D Perspective** (top left), **XY Top**, **XZ Front** and **YZ Side**. All coordinates are Quake units with **Z up**. The toolbar groups actions into MAP, EDIT, TOOLS, VIEW and BUILD; the inspector on the right edits the selection; the status bar shows the cursor's snapped coordinates and messages.

The 3D view has three display modes in its corner: **Brush**, **Textured** (default) and **Wireframe** (edges only, to see through walls).

### Moving around

| Input | Where | Effect |
| --- | --- | --- |
| Middle or right drag | 3D | Look around. |
| Middle click | 3D | Toggle captured free look (yellow frame); Escape releases it. |
| `W` `A` `S` `D` | 3D (pointer over it, or free look) | Fly forward, left, back, right. |
| `Space` / `C` | 3D | Rise / sink. `Shift` flies three times faster. |
| Wheel | 3D | Step along the view direction. |
| Middle drag, wheel | 2D views | Pan, zoom at the cursor. All three 2D views share one centre. |
| `F` / `Shift+F` | Anywhere | Frame the selection / the whole map. |

## Building

| Key | Tool or action |
| --- | --- |
| `B` | **Brush**: drag in a 2D view to draw a box on the grid. The hidden axis gets one grid step from the work plane. |
| `V` | **Select**: click to select; drag to move; drag an edge or corner to resize. Right click deselects. |
| `P` | **Patch**: draw a curved `patchDef2` surface. The **Curves** menu adds Bevel, Inverted Bevel, Arch and Edit Points. |
| `E` | **Entity**: place the class picked in the toolbar list. |
| `T` | **Texture browser**. Click a texture to make it current for new brushes, or to apply it to selected faces. |
| `H` | **Map Health**: problems in the map; click one to select and frame the object. |
| `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) | Undo / redo. |
| `Ctrl+D` / `Delete` | Duplicate / delete the selection. |
| `[` / `]` | Smaller / larger grid (8, 16, 32, 64). |
| `Escape` | Cancel a drag, close a menu, deselect. |

While resizing one edge, type a number for an exact size (`Enter` commits, `Backspace` edits). A size label follows the cursor and turns red at the one-grid-cell minimum.

### Textures

- Shift+click a face in the 3D view to select it for per-face texturing (Shift+click again to toggle); Alt+click samples a face's texture as the current one.
- Texture faces nobody sees with `common/caulk`, then texture the visible faces.
- Texture names have no `textures/` prefix; the compiler adds it.

### Entities

The Entity tool places spawns, lights, weapons, items and other point entities from the game's entity definitions. The inspector edits the class, origin and keys; documented keys show their defaults, required keys are starred, and unknown keys are kept.

Brush entities (triggers, doors, plats) are made from brushes: select a brush and pick an entity class in its inspector. Triggers get the trigger texture automatically. A teleporter is a `trigger_teleport` brush whose `target` matches a `misc_teleporter_dest`'s `targetname`.

Every room needs a `light` entity, and every map at least one `info_player_deathmatch`.

## Saving

- **Save Draft** (`Ctrl+S`) keeps the map in the browser's local storage. **Local Drafts** reopens older ones. Drafts survive a page reload.
- **Export .map** (`Ctrl+Shift+S`) downloads the map source.
- **Server Save** and **Server Maps** store numbered revisions with the SHAGGED server (below).

Give a new map a **Map ID** (lowercase, e.g. `arena1`) in the MAP menu before its first server save: it becomes the name you play it with, `map arena1`.

## Compile and playtest

Compiling needs the SHAGGED server and the MakeBSP/MakeLight toolchain (bundled for Windows in `tools/makebsp`):

```text
npm run shagged:server
npm run shagged:server -- --check-config   # show the resolved toolchain and folders
```

With the server running, the BUILD group is enabled:

1. **Compile** saves the current map as a server revision and builds it. **Status** shows the stage and log; a leak fails the build.
2. **Playtest** (enabled once the current revision is built and published) saves your editor state, closes the editor and starts the map in a local match.
3. **Return to Editor** in the match's pause menu, or `editor return` in the console, comes back with the same draft, selection and cameras.

The same compile runs from the command line with `npm run shagged:compile -- <mapid>`.

## Limits

- Brushes are axis-aligned boxes; curved surfaces are patches. Angled brushes and boolean (CSG) operations are not available yet.
- Importing arbitrary NetRadiant `.map` files is not supported yet.
- Selection is one object at a time; multi-select and groups are planned.
