# SHAGGED map editor

SHAGGED (SHAG General Editor) is the brush editor built into the engine. It opens from the game console, edits maps in four views, compiles them with MakeBSP/MakeLight and launches them for a playtest. Maps can also be built from scripts or AI agents: see the [SHAGGED scripting API](./shagged-api.md).

Design notes and status: `docs/research/SHAGGED.md` in the repository.

## Opening the editor

In the game console (from the lobby):

```text
developer 1
editor open
```

`editor close` (or the gold **✕** button in the top-left corner) saves the draft and returns to the lobby; `editor status` reports whether it is open and which draft is loaded. Leave a running match before opening the editor. The console stays available while you edit.

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
| `G` | **Vertices**: select a brush, then drag vertex handles in a 2D view. Shift+click toggles several handles. |
| `P` | **Patch**: draw a curved `patchDef2` surface. The **Curves** menu adds Bevel, Inverted Bevel, Arch and Edit Points. |
| `E` | **Entity**: place the class picked in the toolbar list. |
| `T` | **Texture browser**. Click a texture to make it current for new brushes, or to apply it to selected faces. |
| `M` | **Model browser**. Click a model to preview it; double-click (or **Use**) to drop it as a `misc_model`. |
| `H` | **Map Health**: problems in the map; click one to select and frame the object. |
| `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) | Undo / redo. |
| `Ctrl+D` / `Delete` | Duplicate / delete the selection. |
| `[` / `]` | Smaller / larger grid (8, 16, 32, 64). |
| `Escape` | Cancel a drag, close a menu, deselect. |

While resizing one edge, type a number for an exact size (`Enter` commits, `Backspace` edits). A size label follows the cursor and turns red at the one-grid-cell minimum.

The brush inspector's **Rotate Brush** control rotates around X, Y or Z about
the selection's bounds center. Rotation converts a box into a convex solid;
3D brush/textured/wireframe views show its actual faces and the 2D views show
its edges. Bounds handles resize along world axes, while the hull stays convex.
Move, duplicate, delete and undo/redo work on these brushes. **T** textures the
whole convex brush; numeric per-side material editing and creating polygon
prisms/wedges are available through the [scripting API](./shagged-api.md#convex-solids-and-rotation).
The six-face box alignment panel does not edit convex sides. Carving through
convex solids is rejected until convex subtraction is supported.

### Brush vertices

Choose **Vertices** (`G`) and click a brush. Numbered handles appear in all
three 2D views. Drag a handle on the grid; handles at the same projected
position move together, including vertices at different depths. Shift+click
adds or removes a projected group. Drag an already selected handle to move
the selection together; the hidden coordinate stays unchanged.

The inspector lists individual vertices, including overlapping ones. Select
one for exact world XYZ coordinates, or several for a relative XYZ move.
**Apply Vertices** and each completed drag are one undo step. Escape cancels
a drag. Use **Select** (`V`) for whole-brush resizing or deletion.

The first edit converts a box to a convex brush. The convex envelope is rebuilt:
warped faces split, coplanar faces merge, and vertices inside the envelope are
removed. Existing side materials carry to the closest matching source faces;
review texture alignment after reshaping. Vertex and side indices can change.
Edits that collapse the solid or exceed hull limits are rejected, preserving
the document. Concave shapes require several brushes.

### Textures

- Shift+click a face in the 3D view to select it for per-face texturing (Shift+click again to toggle); Alt+click samples a face's texture as the current one.
- Texture faces nobody sees with `common/caulk`, then texture the visible faces.
- Texture names have no `textures/` prefix; the compiler adds it.

### Entities

The Entity tool places spawns, lights, weapons, items and other point entities from the game's entity definitions. The inspector edits the class, origin and keys; documented keys show their defaults, required keys are starred, and unknown keys are kept.

Brush entities (triggers, doors, plats) are made from brushes: select a brush and pick an entity class in its inspector. Triggers get the trigger texture automatically. A teleporter is a `trigger_teleport` brush whose `target` matches a `misc_teleporter_dest`'s `targetname`.

The compiler section also offers projected `misc_decal` and `misc_text_decal`
point entities and the `func_group` brush class. Their documented projection,
vertex tint/alpha and chamfer keys appear in the inspector. Review decals in
the compiled BSP; chamfers require default or release quality. A compiler
group does not make its geometry nonsolid.

Every room needs a `light` entity, and every map at least one `info_player_deathmatch`.

### Models

The model browser (`M`) lists every model in the game packages by folder, with **Recent** and **In this map** groups and a search box. Clicking a model turns it in the preview with its size in units; drag the preview to orbit it and use the wheel to zoom.

Double-click a model, or press **Use** or `Enter`, to pick it. With a `misc_model` selected, the pick replaces its model in one undo step. Otherwise the Entity tool switches to `misc_model`, and each click in a 2D view drops the model with its base on the work plane. **Browse…** in a `misc_model`'s inspector opens the same browser.

Placed models are drawn in the 3D view, and their boxes in every view follow the model's size, `modelscale` and `angle`. MD3 models show their image without shader effects; MakeBSP decides how the compiled model looks.

Compiler-native ASE model references can also be placed and exported, including
the Warfork map prop collection. ASE has no browser mesh preview; review its
appearance, orientation and bounds in a compiled playtest. Use `collisiontype`
according to the compiler's rules and prefer simple collision proxies for detail.

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

- Brushes can be boxes or convex solids; curved surfaces are patches. Boolean subtraction is limited to boxes through the scripting API's `brush.carve`.
- Arbitrary NetRadiant `.map` files cannot be imported.
- Selection is one object at a time, with no multi-select or groups.
