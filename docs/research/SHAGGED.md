# SHAGGED — SHAG General Editor

**Status:** active M2/M3 implementation, 2026-10-03. Closed-room MakeBSP compile acceptance and real-browser editor interaction are verified. Point entities and the first server Save/Open/Compile backend slices have landed; browser wiring and playable BSP delivery remain.

## Implementation checkpoint

The first M1 slice now has the developer-gated `editor` command, a browser
host that suspends/restores the lobby game view, four panes (Babylon perspective
and XY/XZ/YZ canvas projections), grid-aligned box drawing and movement,
selection, undo/redo, named `localStorage` drafts with a chooser to reopen older
work, numeric XYZ bounds and shader
editing, duplication, recovered grid/zoom/tool/selection/camera state, and
deterministic `brushDef` export. Brush drags now capture an explicit work-plane
coordinate and one-grid thickness; a transient box and dimension readout
appear in all three orthographic panes and the perspective scene. The Room Template creates six enclosing
brushes and an `info_player_deathmatch` spawn for the eventual compiler check.
Compile, status, and Playtest remain unavailable in the editor UI while the
new Node compile service is wired to it. A DOM/NullEngine smoke test covers perspective
picking and the main editing controls.

**Compiler acceptance, verified (2026-10-02):** a local NetRadiant Custom
install (`makebsp.exe`/`makelight.exe`, with this repository's own
`editor/makebspdata/washoi.json` already installed into it) compiled the
Room Template's exported `.map` with the documented Washoi FAST recipe
end to end — `makebsp -game washoi -fs_basepath <public/data> -leaktest
-fast -samplesize 8`, then the matching `makelight -fast` — with no leak,
and the resulting `.bsp` loads cleanly through SHAG's own `BspLoader`
(`npx vite-node src/cli/headless-bsp.ts info <file>` reports FBSP v1, 6
faces, 1 model, as expected for a sealed six-brush room). This closes the
M1 export-validity claim's compiler unknown.

The light-grid count mismatch noted above is now explained and not an
exporter defect: hand-adding one `"classname" "light"` entity to the same
exported `.map` (SHAGGED has no light-entity authoring yet; this edit was
made directly in the `.map` text, outside the editor) and recompiling
changed `makelight`'s own log from `CompressGrid: 75 points compressed to
1 unique points` to `75 points compressed to 75 unique points`, and
`BspLoader`'s predicted-vs-actual gap narrowed from 3-vs-49 (94% off) to
281-vs-294 (4% off) — a residual gap of the same size already seen on real
shipped maps per prior `v0.9.25` validation notes, not something SHAGGED
introduced. MakeLight collapses an all-dark room's grid to a single
compressed sample; `BspLoader`'s dimension check doesn't know about that
compression and warns, but the room still loads and lights correctly once
it has any light source. No exporter change needed.

**Open/close/reopen hygiene, verified (2026-10-02):** three full
`editor open` → draw/Exit → `editor open` cycles in the same page left
exactly one `.shagged` root and the expected five canvases (one main game
canvas, one unrelated small lobby canvas, three orthographic panes) after
each open, and exactly two after a final Exit — no duplicate roots or
leaked canvases across repeated cycles. Every `EditorSession` listener is
registered with `{ signal: this.listeners.signal }` against one
`AbortController`, aborted once on `dispose()`, which is the code-level
reason this holds up; not independently verified at the raw
listener-count level (no DevTools `getEventListeners` access from a plain
CDP `Runtime.evaluate`).

**Toolbar shortcuts, fixed (2026-10-02):** checking the M1 shortcuts table
below against `EditorSession.keyDown` found three it didn't match: `Ctrl/
Cmd+Shift+S` ran Save instead of Export (no shift check), `[`/`]` did
nothing (only the grid dropdown worked), and `Escape` did nothing (a drag
could only be cancelled by `pointercancel`, and the drafts popover had no
keyboard close). All three now work as documented; verified live and with
new `EditorSession.test.ts` cases.

**Status bar cursor coordinates, added (2026-10-03):** the M1 status-bar
contract below lists "cursor Quake coordinates" alongside the brush-preview
dimensions it already showed while dragging, but a plain hover (no drag)
never touched the status bar at all. `pointerMove` now tracks the hovered
pane's snapped Quake coordinate (the two visible axes plus the active
work-plane value for the hidden one) whenever no gesture or pan is in
progress, clears it on `pointerleave` and while a drag is active (the
preview-size readout already covers that case), and `status()` is split
into a `lastMessage` field plus a `renderStatus()` redraw so a hover
refresh doesn't overwrite whatever the last real event said. Verified live
and with a new `EditorSession.test.ts` case.

**Real-browser interaction, verified (2026-10-02):** headless Edge over CDP
confirmed `developer 1; editor open` opens the four-view editor from the
console; a real pointer drag in the XY pane creates a grid-snapped box
brush that renders correctly in all three orthographic panes and the 3D
perspective view; the inspector shows its exact bounds and shader; and
Exit/reopen round-trips the session (including recovering the same draft
after a full page reload, via `localStorage`). This pass found that opening
the editor silently closed the debug console (`src/main.ts`'s suspend-game
callback called `debugConsole.close()`), contradicting this document's own
"the console remains available in editor mode" contract (see **Console
launch and mode lifecycle** below) — fixed by removing that call; the
console's open/closed state is now left alone when the editor opens, like
every other composition.

**Review fixes (2026-10-03):** a read-through of `EditorSession` found three
defects, each now covered by a DOM test that failed first. (1) Select-tool hit
tests used the grid-snapped pointer, so a brush narrower than the grid could
not be clicked (grid 64, brush x 16..48: a click at 32 snapped to 64). Hit
tests now use the exact point; the gesture start stays snapped. (2) `draw()`
reset the status message on every call, so a rejection message vanished in
the same frame it was set. (3) The inspector was rebuilt on every `draw()`,
so a pan or wheel zoom discarded a half-typed value; it is now rebuilt only
when the draft, selection or revision changes. Export order also switched
from `localeCompare` to code-unit order, so the bytes cannot depend on the
machine's locale (ICU gives the hyphens in every UUID special treatment).

**M2 point entities (2026-10-03).** Status: point-entity placement done;
brush entities followed the same day (below).
- **Schema:** the document moves to schema version 2. `entities:
  PointEntity[]` holds an `id`, `classname`, `origin`, and a `keys` map for
  every other key, including keys the editor doesn't know. IDs are unique
  across brushes and entities. A version 1 draft is migrated on load: its
  `testSpawn` becomes an `info_player_deathmatch` entity.
- **Validation:** classnames and keys must be identifiers. `classname` and
  `origin` are structured fields, not free keys. A value with `"` or a newline
  is rejected, because a `.map` value has no escape syntax.
- **Catalog:** `EntityCatalog.ts` parses
  `editor/gamepacks/washoi.game/basewashoi/entities.def`. That file is derived
  from the engine's entity readers. The catalog keeps the point classes of
  the gameplay sections (56 classes in 7 sections) and leaves out brush
  classes and the compiler-only and raw-`.map`-only sections.
- **Placing:** the Entity tool (`E`) and the toolbar class picker place one
  entity per click. Seen from above, the entity's box stands on the work
  plane.
- **Editing:** Select picks entities ahead of brushes. Entities can be moved
  with a preview, duplicated, deleted, undone and framed. They appear as
  class-coloured boxes in every pane and are pickable in 3D.
- **Inspector:** edits the class, the origin, the documented keys (with their
  defaults as placeholders), any undocumented keys, and a new key. An empty
  value removes a key. Values are set through DOM properties, never markup.
- **Export:** classname, then origin, then keys in name order, with entities
  in ID order.
- **Room Template:** now has a `light` entity, so its compiled room is lit.
- **Compiler proof:** the template plus an editor-placed
  `weapon_rocketlauncher` compiled with MakeBSP/MakeLight FAST (exit 0, no
  leak, peak lightmap intensity 361, against 0.000 unlit). All three entities
  came back out of the BSP entity lump through SHAG's own loader.
- **Browser check:** placement, markers and the inspector were checked in a
  browser.
- **Still open:** brush resize and inspector shader edits apply to brushes
  only.

**M2 brush entities (2026-10-03).** Status: done. With point entities above,
this meets the M2 entities compile gate ("one point entity and one brush
entity") except for groups, which are the separate multi-select item.
- **Ownership:** a brush entity owns brushes by ID (`brushEntities: [{ id,
  classname, keys, brushIds }]`); owned brushes stay in `brushes` and leave
  worldspawn on export. Validation requires every owned brush to exist, no
  brush to have two owners, and no entity to be empty. `pruneBrushEntities`
  runs inside the same transaction as any delete or ownership change, so
  deleting a brush or moving the last one out removes the entity.
- **Keys:** `origin` and `model` are refused as keys. Per `entities.def`
  the engine adds origin to the already world-space submodel box, and MakeBSP
  assigns `model` (`*N`). Keys the definition marks "-- required" are
  starred in the inspector, and a missing one shows a warning; for example, a
  trigger without `target` "is dropped silently at load".
- **Compatibility:** the field is optional and additive (schema version 2 is
  unchanged). Drafts and server sidecars saved before it stay valid, and
  `EditorDocument` normalises it to `[]`.
- **Catalog:** brush classes come from the same gameplay sections:
  `trigger_teleport`, `trigger_push`, `trigger_once`,
  `trigger_multiple`, `func_button`, `trigger_hurt`, `func_door`,
  `func_plat` and `trigger_capture_area`.
- **Editor:**
  - The brush inspector's Entity picker offers World, the map's existing
    brush entities, and a new entity of any brush class. Starting a
    `trigger_*` sets the brush to `common/trigger`, as the definitions
    instruct; movers keep their material.
  - For an owned brush, the inspector also edits the entity's class and keys.
  - A duplicated owned brush joins the same entity, so a multi-brush door is
    built brush by brush until multi-select exists.
  - Owned brushes are drawn in their class colour in every pane.
- **Compiler proof:** the Room Template plus a `trigger_teleport` (target
  `dest1`, with a `misc_teleporter_dest` named `dest1`) and a two-brush
  `func_door` compiled with exit 0 and no leak. `BspLoader` reads 3 models
  (world plus 2 submodels); MakeBSP wrote `"model" "*1"` on the door and
  `"model" "*2"` on the teleporter, and no origin.
- **Browser check:** making a drawn brush a trigger, the warning, the trigger
  shader and the class colour were checked in a browser.

M1 plus point and brush entities is in place. Face/UV editing, groups,
and the playable build/return loop remain. The first M3 backend slices now
store numbered `.map` revisions with optional matching editor sidecars and
offer loopback Save/Open endpoints. `shagged:server` and `shagged:compile`
share Washoi recipes and a MakeBSP/MakeLight job runner. A job becomes
`compiled` only after both tools exit successfully and its output has an FBSP
v1 header; it never reports `playable` yet. The browser controls and exact BSP
delivery to client and game server remain separate work. Job status/logs live
in server memory; saved source revisions survive restarts. The configured
CLI-to-real-toolchain path has not been run in this backend slice because the
binaries are absent from `PATH` in this workspace.

Orthographic navigation now supports middle-drag pan and wheel zoom anchored
under the cursor. M1 uses a shared Quake-space view center and zoom across the
three projections, saved per draft; panning a visible axis moves it in the
companion panes too. Frame (`F`) centers all views on the selected brush, or all
brushes when nothing is selected. Frame All (`Shift+F`) always uses the whole
document. Framing respects the current zoom limits (0.25–4 pixels per unit)
and perspective radius limits (32–5000 units), so very large bounds may extend
outside the view. `EditorViewTools.ts` keeps projection, pan, zoom-anchor, and
combined-bounds calculations independent of Babylon and DOM.

## Decision

A focused brush editor inside SHAG is viable. The first useful version should provide NetRadiant's four-view workspace (perspective plus XY top, XZ front, and YZ side), create and edit axis-aligned box brushes on a grid, and export a deterministic Quake-family `.map` source file. MakeBSP remains the compiler; SHAGGED produces source and offers an editor preview. M1 should prove a closed-room export compiles with MakeBSP through an offline fixture check; M3 adds the server compile jobs and proves SHAG can play the exact result.

The UI and geometry editor should be an **engine-owned tool launched from SHAG's console** (proposed `src/engine/editor/` plus `editor` command), not a new game package or an FPS gametype. It takes over the active canvas/rendered scene while open. Save its draft and UI state before playtest, tear down the editor scene, then launch the compiled map through the existing gameplay command. Returning reconstructs the editor from that saved state. The console is the first entry point, not an optional integration. The current FPS shell scene may remain allocated but idle until the host is refactored; only one composition updates and renders at a time.

## Verified starting point

| Evidence | Consequence |
| --- | --- |
| [`raw-map-system.md`](../manual/guides/raw-map-system.md), `src/engine/loader/map/MapParser.ts`, `BrushGenerator.ts`, and `src/engine/MapRenderer.ts` already parse/render text-map brushes. | Useful for previews and round-trip checks, but the current parser normalizes `brushDef` to classic plane fields and discards the brush primitive UV matrix and trailing flags. It is **not** a lossless editor document model. |
| `src/engine/loader/map/MapLoader.ts` finds indexed BSP maps; its local `.map` branch is TODO. [`map-launching.md`](../manual/guides/map-launching.md) describes a separate gameplay launcher. | The editor previews source geometry itself. Playtest later uses normal `map <name>` after the compiled map has been made available to the existing game path. |
| `src/tools/MapGenerator.ts` writes six-plane box brushes in `brushDef` syntax with a UV matrix and shader name; `src/tools/generate-map.ts` writes `.map` files. | There is a local serialization example, but it is private to a procedural generator and its variables use Y as up. Build a pure Quake Z-up editor serializer and check its output with MakeBSP during M1. |
| `editor/gamepacks/washoi.game/basewashoi/default_shaderlist.txt` documents unprefixed face names and a MakeBSP lookup pitfall: a face named `textures/blx/blx_dark` is resolved as `textures/textures/blx/blx_dark`. | SHAGGED's shader picker and exporter must use the exact Washoi `.map` face-name convention. A map that merely compiles may still have missing textures or lightmaps. |
| `src/engine/loader/bsp/mesh/coordinates.ts` maps Quake `(x,y,z)` to Babylon `(x,z,y)` and reverses triangle winding. | Store editor geometry in Quake coordinates, where Z is up. Convert only at rendering/picking boundaries; never export Babylon coordinates. |
| `src/engine/EngineScene.ts` already uses Babylon orthographic camera mode. `src/main.ts` owns the active FPS scene/camera. | Orthographic support exists in Babylon, but the game camera system is not a four-view editor controller. |
| `editor/makebspdata/washoi.json` defines the Washoi profile from `qfusion`, with `FBSP` v1, 18 lumps, 512 px lightmaps, and root media directory. `editor/gamepacks/washoi.game/default_build_menu.xml` declares FAST, DEFAULT, and RELEASE MakeBSP + MakeLight commands. | The intended compiled target and command shape are known. The actual binary/version, executable location, file handoff, and end-to-end result still need a local spike. |
| `package.json` has `tools:map`, `cli:game`, `cli:bsp`, `typecheck`, and `test:run`. It has no SHAGGED or MakeBSP script. | Document and test an explicit compiler command once the binary and its arguments are located. |
| `src/engine/console/commands/index.ts` auto-discovers `*Command.ts`; `src/main.ts` enables `DebugConsole` and calls `registerEngineCommands()`. `CommandRegistry` supports help metadata, developer gating, explicit failures, and unregistering. | An engine `EditorCommand.ts` is the natural console surface. It should delegate visual startup to a registered browser host rather than assume every command composition has a DOM or GPU. |
| `src/main.ts` owns a render loop that always calls `player.update()` and `scene.render()`. `SceneCommand.ts` directly stops/replaces the engine render loop for its inspection scene. | Editor entry cannot be only a new command file. A deliberate mode switch in the browser composition is required, and it must not inherit `scene empty`'s render-loop takeover pattern. |
| `src/cli/lobby-server.ts` starts a separate Node service; `src/lobby/GameServerSpawner.ts` already uses child processes for game servers. `src/games/fps/client/FpsMapLauncher.ts` uses the lobby's development-server request. | A separate SHAGGED backend is a familiar repo pattern. It can own `.map` files and MakeBSP jobs without putting filesystem/process code in the browser or adding editor concerns to the lobby server. |
| `DebugConsole` lives in DOM, releases pointer lock on open, and remains usable over the canvas. `InputSystem` binds document and canvas listeners; `FPSController` has `setGameplayFrozen` and `setEnabled`. | Console access can remain available while editing, but gameplay input and pointer grabs must be suspended and restored explicitly. |

NetRadiant Custom is a **behavior and format reference**, not a porting base. Its source has separate [orthographic XY/XZ/YZ views and brush drag logic](https://github.com/Garux/netradiant-custom/blob/master/radiant/xywindow.cpp) and [window/layout composition](https://github.com/Garux/netradiant-custom/blob/master/radiant/mainframe.cpp). Its [README](https://github.com/Garux/netradiant-custom#features) lists axial, brush primitive, and Valve 220 brush formats and automatic conversion. Choosing one export dialect for milestone 1 is therefore deliberate. Use the upstream source to settle winding, texture axes, and edge cases; do not copy its GPL implementation into TypeScript without a separate licensing decision.

## Feature matrix and proposed order

This matrix describes **editor features to build**, not features already available in the UI. Existing SHAG parsers/renderers are listed only as reusable substrate. M1 is the export milestone below and includes visible Compile/Status/Playtest controls; M2 makes the editor practical for ordinary maps; M3 connects compilation to normal game playtest and return; M4 adds authored curved geometry. M2 and M3 can progress independently after M1; M4 authoring work can start earlier, but its full compiled-collision acceptance needs M3's playtest path.

| Feature | Target | First useful behavior | SHAG substrate / main gap |
| --- | --- | --- | --- |
| Console launch and four views | M1 | `editor open` gives perspective, XY, XZ, YZ; `editor close` restores the prior view. | Command auto-discovery and Babylon orthographic cameras exist; mode lifecycle and pane input do not. |
| Box brush creation and `.map` export | M1 | Drag snapped boxes, set hidden-axis extent, assign a shader, save deterministic `brushDef` source. | `MapGenerator` writes boxes and `MapParser` reads them; no editable document/serializer or MakeBSP-verified fixture. |
| Compile, status, and Playtest controls | M1 UI; M3 integration | Show all three controls. In M1, status accurately says when no compiler is configured and Playtest stays unavailable; M3 wires actual jobs and game launch. | Washoi build recipe and `map` launcher exist; packaging/discovery is deferred. |
| Selection and object movement | M1 | Click in any pane to select one brush; drag or enter XYZ to move/resize it; duplicate/delete; selection is shared by all panes. | Babylon picking is available in principle; editor hit testing, grid snapping, handles, IDs, and undo transactions are new. |
| Undo/redo and draft recovery | M1 | One gesture is one undo step; refresh restores a versioned draft and view state from `localStorage`. | New editor document/history work. Meshes must be regenerated from the document, never be the saved state; later server Save writes the canonical `.map`. |
| Textured, solid, wireframe, and textured+edge preview | M2 (textured: **planned**, see "M2 materials") | Per-pane view modes; texture appearance in perspective, clear outlines in orthographic panes; selected edges remain visible over textures. | `BrushGenerator` and debug commands demonstrate wireframe; editor-specific materials/overlays, shader lookup, and UV fidelity are new. Scene-wide `forceWireframe` alone is insufficient for per-pane modes. |
| Face material editing | M2 (**planned**, see "M2 materials") | Pick one or multiple faces, assign a Washoi shader name, adjust basic shift/scale/rotation, preview and export the result. | PK3/shader loaders exist; current raw parser discards brush primitive UV matrices and flags, so editor needs lossless face data. |
| Multi-select and grouping | M2 | Shift-select, marquee-select, group/ungroup, move/duplicate a group, and preserve membership in the editable draft. | New editor-only hierarchy. `func_group` appears in Washoi `entities.def`, but its compiler semantics need proof before using it for persistence; grouping must not silently change game entity ownership. |
| Point entity placement | M2 (**done 2026-10-03**) | Place a spawn, light, pickup, or target marker in 2D/3D; edit `classname`, origin, angle, and class-specific keys in an inspector. | Done: `EntityCatalog.ts` reads the gameplay point classes from `entities.def`; schema v2 `entities` with preserved unknown keys; markers in all panes; deterministic export; compiled and read back through `BspLoader`. |
| Referenced model placement (`misc_model`) | M2+ (**partial 2026-10-03**, see "Referenced models") | Place a model reference, edit its path/yaw/scale, and export compiler keys; loose GLB has an initial 3D preview. | Palette, indexed-path suggestions, validation, export and loose-GLB preview exist. MD3/PK3 preview, asset existence checks, compiled transform/material/collision proof remain. |
| Brush entity placement | M2 (**done 2026-10-03**) | Convert selected brushes into a brush entity (for example trigger/door), set keys, and show entity bounds and links. | Done: ownership by brush ID, no origin/model keys, required-key warnings, class-coloured brushes; a teleporter and a two-brush door compiled to submodels `*1`/`*2`. Target-link overlays remain the separate entity-link idea. |
| Simplified modular Block Builder | Optional M2+ | Pick a sized room piece, snap compatible sockets/grid positions, rotate by quarter-turn, and detach it to editable brushes. | Babylon can preview/gizmo repeated pieces; pure Quake-space placement, versioned definitions, and deterministic expansion to `.map` are new. Its detailed proof is below. |
| Raw map preview | M1/M2 | Inspect the editable `.map` through the editor's 3D and orthographic views, with textured/wireframe options as they arrive. | Raw brush and patch renderers exist; editor previews need their own lightweight scene objects. No separate raw gameplay mode is required. |
| Compile and status | M3 | Save/submit a numbered `.map` snapshot to `shagged:server`, follow MakeBSP/MakeLight job status, and retain the last successful build. | Washoi build recipe exists; SHAGGED service, CLI process runner, and revision tracking are new. |
| Playtest and return | M3 | Save the editor session, close the editor scene, make the compiled BSP available to the normal game path, run `map <name>`, then exit the match and restore the editor from `localStorage`. | Existing `map` is server-backed. Browser index, server asset discovery, and a return route need integration later. |
| Curved patch surface editing | M4 | Create a 3×3 `patchDef2`, drag control points, adjust subdivisions and UVs, export and preview it. | `MapParser`, `PatchGenerator`, `MapGenerator`, BSP patch rendering, and BSP patch collision exist; authoring/selection/serialization round-trip are new. |
| Bevel and arch tools | M4 | Presets create editable patch control grids for quarter-round bevels and semicircular arches; user can change radius, width, direction, segments, and shader. | Build on the patch tool. These are patch **surface** presets, not a general modifier that rounds arbitrary solid brush edges. Their solids/collision need companion brushes or verified compiled patch collision. |
| Cylinder, tube, cone, and cap tools | M4 | Draw an axis-aligned footprint and height, then create a cylindrical side, open tube, tapered cone, or matching end caps; adjust axis, radius, segment count, winding, and shader. | Generate one or more editable `patchDef2` surfaces from the same patch document model. A capped shape is several surfaces, not an automatically sealed structural brush. |
| Arbitrary convex brush/CSG tools | Later | Plane clipping, vertex/edge editing, hollow/subtract, and true solid beveling. | Requires robust convex geometry, invalid-brush repair, UV preservation, and extensive compiler tests; separate scope from patch bevel/arch presets. |
| `.map` import and faithful round trip | Later, before editing external maps | Open NetRadiant `.map` files without dropping unknown keys, face UVs, flags, patches, or unsupported entities. | Current `MapParser` is intentionally lossy for `brushDef`; a lossless parser and compatibility corpus are required. |

**Interaction rule:** brush, patch, point entity, brush entity, and group are different selection kinds with one shared selection model. Transforms must act in Quake coordinates and update every view in one undoable transaction. Groups are an authoring convenience; export should flatten editor-only group membership unless a compiler-tested `func_group` mapping is explicitly chosen. An entity is not merely a visual marker: the inspector must preserve arbitrary key/value pairs so the compiler and runtime can receive keys the editor does not yet understand.

**Preview rule:** distinguish editor preview from compiled truth. Solid/textured/wireframe are editor display modes; the compiled BSP view uses the real material, lightmap, collision, and entity paths. A patch may look correct in raw preview while compiled collision differs, so M4 acceptance must include a MakeBSP compile and an in-game walk/sweep test over representative arches and bevels.

### Development milestone gates

The table gives each milestone a reviewable outcome; the feature matrix above remains the detailed scope list. A gate is passed by the demonstrated behavior and evidence, not merely by files or UI controls existing. The implementation checkpoint above records current progress.

| Gate | Depends on | User-visible result | Evidence required to call it done | Outside this gate |
| --- | --- | --- | --- | --- |
| **P0: format and viewport probes** | Existing source/assets | No shipped editor UI; implementation risks become measured. | Find the intended MakeBSP binary and compile a known-good NetRadiant room; record face/shader conventions. Separately prove a disposable Babylon four-camera scene can label, resize, clear, and pick all panes. | Production editor document or server API. |
| **M1: box authoring and export** | P0 findings; host/view/document slices | Console-launched four-view editor; draw/select/move/resize boxes, undo/redo, Save Draft, Export .map; honest compile/playtest controls. | Reopen restores document and view state; export bytes repeat; a closed editor-exported room compiles offline with MakeBSP; open/close/reopen leaves one render loop and no input leaks. | General entities, prefab mode, import, real Compile or Playtest. |
| **M2: useful map assembly** | M1 document/export | Face shader/UV work, selectable entities, multi-select/groups, textured/wireframe previews; optional first box-only Block Builder kit. | Author a small room with spawn, light entity, grouped geometry, and textures; export and offline compile it; inspect shader/entity keys. Baked lighting appearance is checked with MakeLight/playtest in M3. Prefab kit has its own mixed-size snapping/compile proof if included. | Server jobs and playable BSP handoff. |
| **M3: server compile and Playtest loop** | M1; selected M2 entity support can land in parallel | Server Save/Open, Compile/Status, exact-build Playtest, Return to Editor with restored draft. | A numbered source revision compiles through the Node service; the exact build is available to browser and game server; game launches via normal `map`; return restores session; stale/failed builds cannot masquerade as current. | Live raw/BSP hot swap or background gameplay while editing. |
| **M4: authored curves and shape presets** | M1 geometry model and M3 playtest path for full gate | Editable patch curves; bevel, arch, cylinder/tube, cone, and cap presets; export and preview. | Compile representative open and capped shapes, then verify winding, seams, collision, and navigation in-game after Playtest. | Arbitrary convex CSG, true rounded solid edges, general external `.map` import. |

P0 may run alongside the M1 host/console slice; an unavailable MakeBSP binary blocks the M1 **export validity claim**, not all useful browser-host work. M2 and M3 can be developed in parallel after M1. If patch tools are built before M3, label them experimental until the in-game M4 collision gate can run. Future ideas in the sections below do not silently expand these acceptance gates.

### M4 curved geometry: patch surfaces and shape tools

NetRadiant Custom constructs its [plane, cylinder, cone, sphere, bevel, and end-cap prefabs as patch control grids](https://github.com/Garux/netradiant-custom/blob/master/radiant/patch.cpp#L1179-L1506). Its common cylinder is a 9×3 grid with a repeated seam column; bevel is 3×3 and end cap is 5×3. The exact cylinder path supports configurable odd grid dimensions. These are useful format and interaction references, not code to copy. **Tube** below is a proposed SHAGGED authoring tool: it combines patch surfaces to give an open hollow shell, rather than claiming a separate NetRadiant `.map` primitive. Likewise, an arch is a swept/rotated patch preset. In exported `.map`, the result is ordinary `patchDef2` block(s) under the owning entity, with shader, odd width/height, and `( X Y Z U V )` controls; editor recipe parameters belong only in the draft/sidecar.

| Shape/tool | First useful operation | Export and topology | Caveat |
| --- | --- | --- | --- |
| Free patch/curve | Draw a 3×3 plane in an orthographic pane; move control points in any pane, with explicit normal-axis depth and UV controls. | One `patchDef2`; grow by two rows/columns for more spans. | A patch is a surface. Preview subdivision is a display setting, not additional `.map` control points. |
| Bevel/inverted bevel | Drag a bounding rectangle and depth; pick quarter-turn and inward/outward facing. | One 3×3 patch per sweep; optional separate end pieces. | Does not round an existing brush's solid edges. |
| Arch/end cap | Set span, rise, depth, facing, and matching end treatment. | A 5×3 or larger odd grid for a half-round sweep; caps are separate patch records where needed. | Keep adjoining edge control points identical to avoid cracks. |
| Cylinder/cone | Draw diameter/radii and height; choose X/Y/Z axis, sides, and open/capped option. | One side patch with duplicated seam column (for example 9×3 for four quadratic spans); cone collapses one ring. Caps export separately. | Reject radius/height zero and degenerate tip triangles; validate cap compatibility with the chosen side grid. |
| Tube | Set outer/inner radii, length, axis, and open/capped ends. | Matched outer and inner side patches with opposite winding; optional annular end pieces, each exported as its own patch. | A visually closed shell does not imply a sealed BSP volume or guaranteed collision; use structural brushes when the map needs them. |

**Document contract.** Add `patches` to the versioned editor document with stable IDs, owner entity, shader, odd dimensions (at least 3×3), row-major `height × width` controls, finite XYZ/ST, and winding. Keep coordinates in Quake space. A shape recipe stores type, bounds/axis, radii, sweep/segments, cap and UV options, plus its stable child patch IDs. Parametric edits regenerate those children deterministically as **one** undo transaction. A manual control-point edit converts the affected recipe to freeform after an explicit UI choice; it must never silently overwrite hand edits on the next parameter change. Selection, grouping, transform, duplication, deletion, save/reopen, and texture assignment must accept patch IDs alongside brush IDs.

**Implementation order.** (1) Add schema migration, pure patch validation, and a `MapWriter` path for `patchDef2`, with a small golden fixture and parser/compile readback. (2) Render document patches in all four panes using `PatchGenerator` for 3D and control lattice/projection for orthographic views; use the same document data for picking and transforms. (3) Add free 3×3 control editing and UVs. (4) Add pure, deterministic preset generators for bevel/arch, then cylinder/cone/caps and tube, each reusing the writer and preview. (5) Test compiled results through the existing MakeBSP/MakeLight and Playtest path. `MapParser` already reads `patchDef2`, `PatchGenerator` tessellates odd grids, and `MapGenerator` emits examples, but the editor's current document and writer contain only brushes/entities; parser readback alone cannot prove editor round-trip fidelity.

**Interaction.** Put the shape presets in a compact Curves menu, with free Patch and Edit Points alongside them. The active orthographic pane defines the shape plane/axis; dragging bounds gives a ghost in all four views, the hidden-axis height comes from a numeric field or second gesture, and Enter/confirm commits once. The inspector exposes size, orientation, segments, cap style, shader, and UV repeat. Moving a control point shows the lattice and updates all panes live; Esc cancels the transaction. A selected multi-patch shape moves as one selection while its child patches remain individually editable.

**M4 proof set.** Export at least one free 3×3 curve, both bevel windings, a vertical and horizontal arch, an open cylinder, capped cylinder, tapered cone, and open/capped tube. Verify deterministic `.map` bytes and draft reopen; compile with the configured MakeBSP and inspect patch surfaces, shader/UV orientation, normals, cap seams, and degenerate warnings. Then playtest representative walkable curves and collision from both sides where intended. Keep a simple structural-brush room around these samples so leak/visibility failures are not mistaken for patch export failures. Record any MakeBSP limits on grid size, cap generation, collision, or shaders before marking a preset supported.

## Referenced models: `misc_model` (research, 2026-10-03)

A high-poly prop stays in an external model file. The `.map` contains a point
entity with its asset path and transform, not the model's vertices. NetRadiant
Custom's [Q3Map2 model path](https://github.com/Garux/netradiant-custom/blob/master/tools/quake3/q3map2/model.cpp)
reads each `misc_model`, loads the referenced model through the compiler's VFS,
and inserts its surfaces into the BSP. A normal compiled playtest therefore
renders the baked BSP surfaces; it does not need to spawn the source model from
the `misc_model` entity at runtime. The optional
[`-keepmodels` compiler flag](https://github.com/Garux/netradiant-custom/blob/master/tools/quake3/q3map2/bsp.cpp)
retains those entities and needs separate runtime testing before use.

An illustrative `.map` entity (the model path must refer to a real mounted
asset when compiled):

```text
{
"classname" "misc_model"
"origin" "128 64 32"
"model" "models/mapobjects/crate/crate.md3"
"angle" "90"
"modelscale" "1"
}
```

| Stage | Required behavior |
| --- | --- |
| Author | Store `classname: misc_model`, the relative `model` path, Quake-space origin, and transform keys as normal point-entity data. Keep the mesh outside the editor document and `.map`. |
| Preview | Resolve the same asset in the browser, show a selectable mesh in 3D and footprint/bounds in orthographic views, and cache repeated models. Show an explicit missing/unsupported-asset marker instead of a silent empty prop. |
| Compile | Save the `.map` snapshot and let server-side MakeBSP resolve model and material dependencies from its mounted loose files/PK3s. Inspect compiler warnings and the resulting BSP surfaces. |
| Playtest | Load the compiled BSP through the normal game path. Preserve source model files for future editing/compiles; package required shader/texture assets for the compiled appearance. |

**Compiler keys are distinct from raw-preview keys.** In Q3Map2,
`modelscale_vec` takes precedence over uniform `modelscale`; `angles` takes
precedence over yaw-only `angle`. It also reads `_frame`/`frame`,
`_skin`/`skin`, `_remap*`, `spawnflags`, and `_clipdepth` for advanced cases.
These are visible in
[`ModelGetTransform` and `AddTriangleModels`](https://github.com/Garux/netradiant-custom/blob/master/tools/quake3/q3map2/model.cpp).
The first UI slice only needs `model`, `origin`, `angle`, and `modelscale`, while
preserving all unknown keys. Validate forward-slash, VFS-relative paths: no
absolute paths or `..`. Offer `angles` and `modelscale_vec` once preview and
compile transforms have been compared.

**Current SHAG gap.** [`entities.def`](../../editor/gamepacks/washoi.game/basewashoi/entities.def)
labels `misc_model` as raw-.map-only, so [`EntityCatalog.ts`](../../src/engine/editor/EntityCatalog.ts)
omits it from the palette, although the generic document and
[`MapWriter.ts`](../../src/engine/editor/MapWriter.ts) can carry and export its
keys. [`MapRenderer.ts`](../../src/engine/MapRenderer.ts) has a separate raw-map
path that interprets `scale`, `collision`, and `dropToGround`; Q3Map2 does not
use those as the model's compiler transform/collision controls. Its
`ModelLoader.isModelFile` gate presently accepts GLB/glTF/OBJ/Babylon but not
MD3, despite a separate MD3 load path. The editor needs its own explicit model
catalog and transform adapter; reusing that raw path as-is would give a
misleading preview. The server must check that the compiler can see the asset
under its configured VFS root before reporting a clean compile.

**Geometry and collision.** Model surfaces are decorative geometry, not a
substitute for structural brushes that seal the map. SHAG's compiled collision
path deliberately skips some type-3 triangle-soup surfaces with `models/` or
`mapobjects` shaders, so a visible prop is not automatically solid. Use simple
brush/playerclip proxies when collision is required, then verify in playtest.
Q3Map2 has model autoclip options, but their shader/spawnflag behavior should
be tested with our MakeBSP build before exposing a UI switch. A high-poly prop
can also raise BSP size, lightmap cost, and compile time; editor preview
instancing does not imply BSP instancing.

**First implementation slice:** add `misc_model` to the editor's selectable
point classes with a model picker backed by assets visible to both the browser
and compiler; preview a bounded, cached mesh with Quake-to-Babylon transform;
edit `angle`/`modelscale`; write the entity through the existing point writer.
Choose one format proven in both browser and installed MakeBSP before claiming
general format support. Compile a closed test room with two rotated/scaled
copies, inspect their BSP geometry, shaders and lighting, and walk into a
separate collision proxy. A missing model must produce a visible editor issue
and a reported compile warning/failure. Record whether a model's material
names resolve to the expected Washoi shader paths; Q3Map2 derives shader names
from the imported model's material or diffuse texture path.

**Implementation checkpoint (2026-10-03):** `misc_model` is now an editor
point class. Its inspector suggests model paths from the mounted PK3 index,
also accepts manually entered loose paths, edits `angle`/`modelscale`, and
preserves advanced keys. Export rejects missing, absolute, traversing, or
malformed model paths and nonpositive scale. The 3D pane attempts to load a
loose GLB from `/data/` and retains the selectable marker if preview fails;
other formats currently show a marker and an explicit preview limitation.
The model's rendered bounds are not yet used for 2D hit testing or framing.
Loaded loose-GLB previews are reused across selection/redraw and repositioned
when the entity moves; an unchanged missing path is not fetched repeatedly.
This is an authoring/export slice, not proof that an installed MakeBSP accepts
our GLB or that preview transforms/materials match the compiled BSP. The
server now checks each `misc_model` path in the saved `.map` against loose
files and PK3 entries under its configured media root before starting MakeBSP.
Missing, empty, or unsafe paths fail the compile job with a diagnostic in the
job log. This also covers source-only maps without an editor sidecar. The
check establishes asset presence, not whether MakeBSP can decode the model or
resolve its materials; that still requires a real compiler fixture.

## M2 materials: face selection and the texture browser (plan, 2026-10-03)

This turns the "Face material editing" and "Textured preview" rows of the
feature matrix, and the "Material brush and palette" idea, into one buildable
plan. Nothing in this section is implemented yet.

### What exists to build on (checked 2026-10-03)

| Substrate | What it gives the browser |
| --- | --- |
| `PK3Index` (`findByPattern`, `getShaderNames`), built at startup in `main.ts` | The exact file and shader set the game will load. The browser lists what is really mounted, not a hand-kept list. |
| `PK3Loader.getFile` / `PK3TextureLoader.loadTexture` | Image bytes (JPG, PNG, TGA, KTX) for thumbnails and for the textured 3D preview. |
| `Q3ShaderParser` reads `qer_editorimage` | A preview image for shaders with no same-named image (skies, effects). |
| `editor/gamepacks/washoi.game/basewashoi/default_shaderlist.txt` | A curated seed list. It records the `textures/` prefix trap: a face named `textures/blx/blx_dark` is looked up as `textures/textures/...`, and the map compiles but gets no lightmap. |
| `editor/gamepacks/washoi.game/shadertags.xml` | Tag groups (e.g. "Stock / Compiler") for the browser sidebar. |
| Shipped assets | 1,283 base JPG/PNG/TGA images (1,161 of them TGA) in 45 PK3s, after dropping `_norm`/`_gloss`/`_glow`/`_spec` variants, plus KTX images (measured in WO-T0). The largest folders are `boqu`, `exwsw` and `decals`. The grid must be virtualised and thumbnails lazy. |

The current document has one `shader` per brush, and `MapWriter` writes a fixed
brush-primitive matrix `((0.03125 0 0) (0 0.03125 0))` on every face. In brush
primitives, texture coordinates are normalised to the image, so that matrix
repeats every texture every 32 units whatever its size. WO-T0 measured this
(see its results below). New brushes are
hard-coded to `blx/blx_grid`.

### Data model (additive, no schema bump)

```ts
type FaceKey = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
interface FaceMaterial {
  shader: string;                 // unprefixed, e.g. "blx/blx_dark"
  shift: [number, number];        // texels
  scale: [number, number];        // world units per texel (Radiant convention)
  rotation: number;               // degrees
  size: [number, number];         // image size in texels, recorded at assignment
}
interface BoxBrush { /* ... */ shader: string; faces?: Partial<Record<FaceKey, FaceMaterial>> }
```

- **Defaults:** `brush.shader` stays the default for any face without an
  override, so existing drafts and server sidecars stay valid. This follows
  the six-face-keys contract in "Contracts that keep later tools possible",
  without a migration.
- **Recorded image size:** storing the image size when a texture is assigned
  keeps `MapWriter` pure. It turns shift/scale/rotation into the
  brush-primitive matrix without opening any image.
- **One UV function:** export and the textured preview call the same pure
  function, so the preview is exactly what MakeBSP receives.
- **Shader names:** validation keeps the existing safe-name rule and warns
  when a name starts with `textures/`.

### Selecting faces

- **3D pane:** Face-select mode, or Ctrl+Shift+click as in NetRadiant,
  selects the face under the cursor; Shift adds faces. The face key comes
  from the picked triangle's world normal, converted to Quake axes (dominant
  axis and sign), not from the mesh's internal face order. It therefore
  survives any change to how the preview mesh is built.
- **Selection state:** a set of `brushId:faceKey` in UI state. It never enters
  the document or the `.map`. Brush selection and face selection are distinct
  modes, so applying a texture to a brush covers its six faces.
- **Feedback:**
  - Selected faces get a translucent overlay quad in 3D.
  - In an orthographic pane, a selected face that faces the camera is
    outlined.
  - The inspector shows the selected brush as a small six-face net, also
    clickable, which is how to reach faces hidden in 3D.

### Texture browser

- **Layout:** a drawer that slides over the inspector side, so the four panes
  stay usable. `T` toggles it.
  - **Search:** fuzzy matching over folder, name and tags.
  - **Sidebar:** Recent, In this map, the tag groups from `shadertags.xml`,
    then every folder with its count.
  - **Grid:** virtualised. Each tile shows the thumbnail, its name, its pixel
    size, and badges for shader-only, transparent, sky and compiler-special
    (`common/*`). A shader or image that fails to resolve gets a visible
    "missing" tile instead of disappearing.
- **Thumbnails:**
  - Loaded only when a tile scrolls into view (`IntersectionObserver`).
  - The PK3 bytes are decoded with `createImageBitmap`, with TGA going through
    the existing loader. The result is downscaled to about 96 px.
  - Kept in an in-memory LRU and in IndexedDB, keyed by package and path, so
    reopening the editor is instant. Shaders without a same-named image use
    `qer_editorimage`, then their first `map` stage.
- **Applying:**
  - A click applies to the selected faces, or to the whole selected brush, as
    one undo step. Double-click applies and closes. Hovering shows a larger
    preview.
  - Alt+click on a 3D face samples its texture (eyedropper).
  - The applied texture becomes the toolbar's "current texture", which new
    brushes then use instead of the hard-coded `blx/blx_grid`.
- **Keyboard:** arrows move through the grid, Enter applies, Escape closes,
  and typing goes to search.
- **Tags:** the catalog takes them from the mounted index plus
  `shadertags.xml`, so newly added PK3s appear without editing a list.
  Untagged textures sit under their folder; they are never hidden, unlike
  NetRadiant.

### UV tools and textured preview

- **Face inspector:** numeric shift U/V, scale U/V and rotation, with nudge
  buttons, plus Fit (one repeat across the face), Natural (reset) and
  "match neighbour" (copy alignment from an adjacent face).
- **Textured preview:**
  - The 3D pane gets a Solid/Textured toggle. Textured builds each brush from
    six quads with the shared UV function and a plain diffuse material
    through `PK3TextureLoader`.
  - It deliberately doesn't use the full Q3 shader pipeline, per the preview
    rule; a shader-only material shows its editor image.
  - Orthographic panes stay outline-based.

### Work orders

Status: `todo` · `in progress` · `done` · `blocked`. Difficulty: 1
(mechanical) to 5 (deep). The model column is a suggestion. "Touches
session" marks work orders that edit `EditorSession.ts`/`editor.css`, which
the M3 server work also edits. Schedule those after that work commits, and
always stage by explicit path.

| WO | Outcome | Depends on | Touches session | Diff | Model | Status |
| --- | --- | --- | --- | --- | --- | --- |
| WO-T0 | Probe: brush-primitive UV semantics measured from a compiled BSP; thumbnail decode cost measured | none | no | 2 | Opus 5.5 | done |
| WO-T1 | Per-face materials in the document; pure UV function; `MapWriter` writes per-face shader and matrix | T0 | no | 3 | Opus 5.5 | done |
| WO-T2 | `TextureCatalog`: pure catalog from the mounted index, `default_shaderlist.txt` and `shadertags.xml` | none | no | 2 | Sonnet 5 | done |
| WO-T3 | `TextureThumbnails`: lazy decode from PK3 bytes, in-memory LRU, IndexedDB cache | T2 | no | 3 | Sonnet 5 | done |
| WO-T4 | Texture browser drawer: search, groups, virtualised grid, apply to brush, current texture | T1, T2, T3 | yes | 3 | Opus 5.5 | done |
| WO-T5 | Face selection: 3D pick by normal, overlay, six-face net in the inspector, eyedropper | T1 | yes | 3 | Opus 5.5 | done |
| WO-T6 | UV tools: shift/scale/rotation fields, Fit, Natural, match neighbour | T1, T5 | yes | 3 | Opus 5.5 | done |
| WO-T7 | Textured 3D preview: six quads per brush through the shared UV function; Solid/Textured toggle | T1, T3 | yes | 3 | Opus 5.5 | done |
| WO-T8 | Acceptance: painted, aligned faces compile; BSP shaders and texture coordinates match the editor; docs and changelog | T4–T7 | no | 2 | Sonnet 5 | todo |

T0 and T2 can start at once. T1 follows T0, because its UV function encodes
whatever T0 measures. T3 follows T2. T4–T7 are UI work, and T8 closes the
group.

#### WO-T0: probe

- **Question:** what do the two rows of a `brushDef` face matrix mean to
  MakeBSP? The candidates are normalised texture coordinates (independent of
  the image size, as brush primitives are documented) or texels.
- **Method:**
  - Export one box with distinct, asymmetric matrices per face onto an
    image whose width and height differ, so the axes can't be confused.
  - Compile it with the Washoi FAST recipe.
  - Read each face's drawvert ST values back with `BspLoader`.
  - Derive repeats per world unit and the U/V orientation for all six
    faces, and compare them with the matrix written.
- **Decides:**
  - What the fixed matrix `((0.03125 0 0) (0 0.03125 0))` really produces.
  - Which scale convention the inspector exposes: Radiant-style "world units
    per texel", with the default to be chosen from the measurement.
  - The face axis basis the UV function must reproduce.
- **Also:** time decoding all ~1,480 base images to 96 px thumbnails in
  headless Edge. That sets whether T3 needs a worker or batching.
- **Proof:** a recorded table of matrix → measured ST per face. The probe
  script stays in the scratchpad; the result goes into this section.

#### WO-T1: per-face materials and the UV function

- **Data:**
  - `BoxBrush.faces?: Partial<Record<FaceKey, FaceMaterial>>` (shader,
    shift, scale, rotation, size), with `brush.shader` as the default.
  - Additive, no schema bump; validation covers face keys, finite numbers,
    positive size, and the shader-name rule. A `textures/`-prefixed name is
    refused, because MakeBSP would look it up as `textures/textures/`.
- **UV function:** `faceTexMatrix(face, key, size) → [[a, b, c], [d, e, f]]`
  in a pure module, used by `MapWriter` now and by the T7 preview later.
  With no override, output stays byte-identical to today, so earlier exports
  and server revisions don't change.
- **Proof:**
  - Unit tests for every face key with shift, scale and rotation.
  - Byte-identical re-export.
  - A compile with two faces in different shaders, after which the BSP lists
    both shaders, with no `textures/textures/` lookups.
  - Measured ST values matching what T0's model predicts.

#### WO-T2: texture catalog

- **Sources:**
  - Image files under `textures/` in `PK3Index`, with `_norm`, `_gloss`,
    `_glow`, `_spec`, `_emissive` and `_bump` variants filtered out.
  - Shader names from the index.
  - Folder groups and the `common/` specials from `default_shaderlist.txt`.
  - Tag groups from `shadertags.xml`.
- **Entry fields:**
  - unprefixed name, folder, image path or "shader-only", tags;
  - flags for `common/` (compiler-special), sky and transparency where the
    shader says so.
- **Search:** a pure fuzzy match over name, folder and tags.
- **Image size from the shader:** a texture's size (recorded into
  `FaceMaterial.size`) must come from its shader's image when a shader
  exists: `qer_editorimage`, then the first stage `map`. Only bare images
  use their own file. WO-T1's proof found the case: `blx/blx_light_blue` has
  a 256×32 same-named JPG, but its shader (`legacy.shader`) draws
  `textures/lights/bluetrim.tga`. Alignment is normalised, so in-game
  density follows the shader's image.
- **Proof:** tests on the real PK3 data (the 1,283 base images, per-folder
  counts, prefix normalisation, variant filtering, shader-image sizes) plus
  parser tests on small fixtures.

#### WO-T3: thumbnails

- **Pipeline:** PK3 bytes → `createImageBitmap` (TGA through the existing
  decoder) → a 96 px canvas → a blob.
- **Caches:** an in-memory LRU, then IndexedDB keyed by package name, size
  and path, so a changed PK3 refreshes.
- **Scheduling:** requests come from visible tiles only, with bounded
  concurrency.
- **Proof:**
  - Unit tests with a fake decoder and fake storage.
  - A browser check: the largest folder scrolls smoothly, and a second open
    is served from IndexedDB.

#### WO-T4: browser drawer

- **Layout:** `T` toggles a drawer over the inspector side.
  - Search field.
  - Sidebar: Recent, In this map, tag groups, folders with counts.
  - A virtualised grid. Each tile shows the thumbnail, name and size, plus
    badges and a "missing" state.
- **Applying:**
  - Click applies to the selected faces, or the whole brush, as one undo
    step. Double-click applies and closes.
  - The applied texture becomes the "current texture" used by new brushes.
- **Keyboard:** arrow keys, Enter, Escape; typing goes to search.
- **Proof:** DOM tests for search, apply-as-one-step and keyboard; a browser
  check of the full catalog.

#### WO-T5: face selection

- **Picking:**
  - A Face mode, or Ctrl+Shift+click in 3D.
  - The face key comes from the picked world normal mapped to Quake axes.
  - Shift adds faces. Selection is `brushId:faceKey` in UI state.
- **Feedback:** an overlay quad in 3D, an outline in an orthographic pane
  for a face pointing at the camera, and a clickable six-face net in the
  inspector.
- **Eyedropper:** Alt+click samples a face's texture.
- **Proof:** a DOM test of normal → key for all six faces; a browser check.

#### WO-T6: UV tools

- **Fields:** shift U/V, scale U/V and rotation, with nudge buttons, applied
  to every selected face as one step.
- **Fit:** one repeat across the face.
- **Natural:** back to the T0-derived default.
- **Match neighbour:** copies the alignment of an adjacent face, so a texture
  runs continuously around a corner.
- **Proof:** unit tests on the pure operations, and a DOM test of
  apply/undo.

#### WO-T7: textured preview

- **Toggle:** Solid/Textured on the 3D pane.
- **Textured mode:**
  - Six quads per brush, with UVs from `faceTexMatrix`.
  - A plain diffuse material through `PK3TextureLoader`; a shader-only
    material uses its editor image.
  - Not the gameplay shader pipeline.
- **Proof:** with a known texture, preview UVs equal the BSP ST values
  measured in T0/T1 for the same face.

#### WO-T8: acceptance

- **Map:** a small room with different textures on several faces, a rotated
  and shifted face, and a matched corner.
- **Checks:**
  - It compiles with no leak.
  - The BSP shader list matches the editor.
  - Drawvert ST values match `faceTexMatrix`.
  - Every face is lightmapped.
  - When M3 Playtest exists, an in-game screenshot.
- **Docs:** update this section, the feature matrix and the changelog.

#### WO-T0 results (2026-10-03)

**Brush-primitive semantics, measured.**
- **Method:** a floating 128×96×96 box was textured with
  `blx/blx_white_stripe` (128×32 px), with a distinct matrix on each face,
  and compiled with the Washoi FAST recipe. Each compiled face's drawvert
  ST values were then fitted as linear functions of position.
- **Scale test:** with `((1/64 0 c) (0 1/32 f))`, every face measured
  exactly 1/64 per unit in S and 1/32 per unit in T. The image's pixel size
  never enters: brush-primitive ST values are normalised (1.0 is one repeat
  of the image).
- **Rotation test:** with `((0 1/64 c) (−1/32 0 f))`, the off-diagonal terms
  swapped and negated the axes exactly as predicted.
- **Model:** MakeBSP computes **st = M · [p·texX, p·texY, 1]**, with
  q3map2's `ComputeAxisBase` basis. Measured per face:

| Face | texX | texY |
| --- | --- | --- |
| +X | (0, 1, 0) | (0, 0, −1) |
| −X | (0, −1, 0) | (0, 0, −1) |
| +Y | (−1, 0, 0) | (0, 0, −1) |
| −Y | (1, 0, 0) | (0, 0, −1) |
| +Z | (0, 1, 0) | (1, 0, 0) |
| −Z | (0, 1, 0) | (−1, 0, 0) |

Each face's constant terms matched its tag, apart from whole-number offsets
that MakeBSP adds to keep coordinates small (they don't change rendering).

**Consequence for today's export.**
- The fixed `((0.03125 0 0) (0 0.03125 0))` squeezes every texture into
  32×32 world units, whatever its size.
- The gamepack's `default_scale="0.5"` (NetRadiant's 0.5 world units per
  texel) would give a 256 px texture 128 units. So a 256 px texture exports
  4× too dense, and any non-square texture is stretched.
- WO-T1 fixes this for every face whose image size is known.

**Thumbnail cost, measured in headless Edge on the dev server.**
- **Packages:** the 45 PK3s that hold texture images (189 MB) open with the
  engine's `PK3Loader` in about 0.3 s, because JSZip reads only the
  directories.
- **Image count:** there are 1,283 base images (variants filtered out).
  The "about 1,480" counted earlier from the archives also included `.ktx`
  entries.
- **Formats:** 1,161 are TGA, which browsers cannot decode natively, and
  122 are JPG/PNG.
- **Timings:**
  - JPG/PNG through `createImageBitmap` to 96 px: 0.8 ms each.
  - TGA through the engine's `decodeTGA` (a PNG data URL), then to a 96 px
    bitmap: 4.7 ms each, 5.5 s for all 1,161. Two thirds of that is
    `decodeTGA`'s PNG re-encode.
  - The first 60 thumbnails (a full grid page) are ready in 0.27 s.
- **Conclusion:** no worker is needed for T3. Visible-first loading plus
  IndexedDB is enough, and decoding TGA straight to pixels (skipping the PNG
  step) is a worthwhile 3× optimisation.
- **KTX:** the gamepack's `texturetypes` lists `ktx`, so the catalog
  includes KTX images; their thumbnails go through the existing KTX loader.

### Decisions so far

- **Shader names:** unprefixed everywhere, as the gamepack's shader list
  requires. A prefixed name is refused at validation, not silently fixed.
- **Face identity:** the six axis keys of a box. Arbitrary convex faces wait
  for the later geometry work, per "Contracts that keep later tools
  possible".
- **No hidden textures:** an untagged texture is listed under its folder,
  never hidden.
- **Preview:** a plain diffuse material only. The compiled BSP is the truth.
- **Natural alignment** (settled by T0): the gamepack's `default_scale`
  of 0.5 world units per texel, with no shift and no rotation, on the
  measured axis basis.
- **Faces with no recorded image size** (every brush made before T1)
  keep today's fixed matrix, so their exports don't change silently.
  Picking a texture from the browser records its size and switches the face
  to the real alignment; the inspector says when a face is still on the
  fixed matrix.
- **UV parameters to matrix:** with image size w×h, scale su/sv (world
  units per texel), rotation θ and shift (texels), the matrix is
  `[[cosθ/(su·w), sinθ/(su·w), shiftU/w], [−sinθ/(sv·h), cosθ/(sv·h),
  shiftV/h]]`, applied to `[p·texX, p·texY, 1]`. T1's tests check it
  against the T0 measurements.

### Progress log

- 2026-10-03: plan written and broken into work orders T0–T8.
- 2026-10-03: WO-T0 done. The brush-primitive model, the axis basis, the
  fixed-matrix density defect and the thumbnail costs are measured and
  recorded above.
- 2026-10-03: WO-T1 done.
  - **Model:** `BoxBrush.faces` holds per-face `FaceMaterial`
    overrides. Validation refuses a `textures/` prefix, a zero or huge
    scale, a non-integer or oversized image size, and unknown face keys.
  - **UV module:** `FaceUv.ts` holds the measured axis basis,
    `faceTexMatrix`, `naturalFace` and `faceST`. Its tests pin both T0
    gradient tables for all six faces.
  - **Writer:** `MapWriter` writes each face's own shader and matrix to
    ten decimals, so 0.0078125 survives. A face without an override is
    byte-identical to before, which a golden line checks.
  - **Compile proof:** a box with `blx_white_stripe` on +Z (shift
    16/4, scale 0.5/0.25, rotated 30°) and `blx_light_blue` on +X
    (shift −40, scale 1/0.5) compiled with no leak. The BSP lists both
    shaders with a single `textures/` prefix, and every vertex's ST
    matches `faceST` modulo 1 (worst error 0 and 1.5e-6).
  - **Lightmaps:** the stripe face is lightmapped. The light-blue face
    has none because its shader is `surfaceparm nolightmap` and a surface
    light, which is correct.
- 2026-10-03: WO-T2 done.
  - **Catalog:** `TextureCatalog.ts` (pure) builds entries from the
    mounted files and parsed `textures/` shaders. Each entry has the
    unprefixed name, folder, the image the game draws (editor image, then
    stage map, then same-named file, with extension swaps as the engine
    does), tags, and flags for compiler, sky, transparent, nolightmap, fog
    and solid colour.
  - **Missing:** an entry is "missing" only when a stage map the game
    draws is in no package. A fog volume, a `$whiteimage` colour, or an
    absent editor image is "no preview".
  - **Search:** `searchCatalog` ranks a whole word in the name first,
    then a segment start, then letters in order (`bdark` finds
    `blx/blx_dark`); tags are searched too.
  - **Folders:** `catalogFolders` groups folders case-insensitively.
  - **Loader:** `TextureCatalogLoader.ts` loads every package that holds
    images or shader scripts (skipping loaded ones), parses the scripts and
    `shadertags.xml`, and shares one promise per page.
  - **Measured on the installed packages, identically in a Node test and in
    the browser:** 2,101 entries, 100 folders, 1,235 shaders, 236 tagged
    and 31 missing, built in 0.59 s in the browser.
  - **Review:** the Node/browser comparison caught two adapter bugs, now
    fixed: folders split by case (101 vs 100), and packages skipped when
    shaders drew images from outside `textures/` (34 vs 31 missing).
  - **Not used:** `default_shaderlist.txt` isn't needed. It is a
    NetRadiant seed list, and the mounted index is the complete source.
- 2026-10-03: WO-T3 done.
  - **Service:** `TextureThumbnails.ts` (pure, injected I/O).
    - Each thumbnail carries its source image's size, which becomes
      `FaceMaterial.size` when a texture is applied.
    - An in-memory LRU revokes evicted object URLs.
    - IndexedDB entries are checked against a package version (name, size,
      timestamp), so a changed PK3 refreshes.
    - Concurrent requests for one path share one decode, and failures are
      remembered rather than retried.
    - A burst of requests (one render of the visible tiles) forms a batch.
      The newest batch runs first, in request order, and a queued request
      can be cancelled when its tile scrolls away.
  - **Review:** the scheduling test caught that "newest first" was wrong both
    ways: the first requests always took the free slots, and pure
    newest-first would fill the screen bottom-up. Batching fixed both.
  - **Browser wiring:** `TextureThumbnailsBrowser.ts`.
    - TGA goes through the new DOM-free `decodeTGAPixels` (split out of
      `TgaDecoder.ts`; `decodeTGA` now wraps it unchanged), skipping the
      PNG re-encode.
    - KTX goes through the engine's exported `parseKTX1` and
      `softwareDecodeMip`, from the smallest mip at least 96 px wide.
      All 271 KTX-only textures are ETC1 (0x8D64).
    - 24 uncompressed KTX masks (luminance-alpha 0x8045, alpha 0x803C) are
      expanded directly.
    - The only entry without a preview is `env/wamphi3.ktx`, a six-face
      cubemap.
  - **Measured in headless Edge over the full catalog:** 2,050 of 2,051
    entries with an image get a thumbnail.
    - Cold, once per package version: 8.3–10.4 s for everything, and the
      first 60 tiles in 0.23–0.37 s (the machine was shared).
    - Warm reopen from IndexedDB: about 0.3 s for everything, and the first
      page in about 20 ms.
    - Recorded sizes check out: 128×32 for `blx_white_stripe`, 256×32 for
      `bluetrim.tga`.
  - **Regression set:** `TgaDecoder.ts` is under `src/engine/loader`, so the
    AGENTS.md renderer set was run. Simulation, physics, server tick
    (determinism checksums match), the 1,000-tick fuzz, and the headless
    `wdm2` BSP load all exit 0.
- 2026-10-03: WO-T4 done.
  - **Component** (`d43ca471`): `TextureBrowser.ts` with its own
    `texture-browser.css`, built apart from `EditorSession.ts` while that
    file was being edited for misc_model work.
    - The drawer has search, a sidebar (All, Recent, In this map, tag
      groups, folders with counts), and tiles with thumbnail, name and
      badges. Missing textures and colour shaders get their own tiles.
    - Plan deviation: tiles render in pages as the grid scrolls, rather than
      in a fully virtualised grid. Each thumbnail loads while its tile is on
      screen and is cancelled if the tile leaves first, which bounds the
      up-front work as well and is testable in jsdom.
    - Keyboard: arrows (extending the page), Enter, Escape, and typing goes
      to search.
  - **Editor hook:**
    - A Textures (T) toolbar button and a current-texture label. The drawer
      is created on first use, so opening the editor never loads the
      catalog.
    - Picking a texture with a brush selected sets the brush's shader and,
      when the image size is known, natural alignment on all six faces, as
      one undo step.
    - The picked texture becomes the current texture, which newly drawn
      brushes use instead of the hard-coded `blx/blx_grid`. Without a known
      size, a brush keeps the fixed legacy alignment and the status says so.
  - **Browser check** (headless Edge, real catalog): the `boqu` folder
    showed 205 textures, the first page rendered 120 tiles with only the 20
    on screen loaded, and applying `boqu/boqu_window` recorded 256×128 on
    the selected brush.
  - **Test harness:** it now waits for the editor launcher before opening,
    because a lobby server on port 9000 races the console `editor open`
    during page startup.
  - **Follow-up:** the gamepack's many tags push the folder list far down
    the sidebar; collapsible sections would help.
- 2026-10-03: WO-T5 done.
  - **Picking:** Ctrl+Shift+click in 3D adds a face of the clicked brush to
    the face selection, or removes it. The face key is the picked normal's
    dominant axis and sign (`faceKeyFromNormal` in `FaceUv.ts`), after
    mapping Babylon's Y-up axes to Quake's Z-up ones.
    - Plan deviation: there is no separate Face mode, and Ctrl+Shift
      toggles rather than Shift adding. One chord covers adding and
      removing, and a plain click keeps its brush-select meaning.
    - Plan deviation: the selection is a set of face keys on the selected
      brush rather than `brushId:faceKey` pairs. Picking a face on another
      brush selects that brush and starts a new face set, so faces never
      span brushes; T6's alignment fields act on one brush.
    - A plain click in 3D, any ortho selection, or losing the selection
      clears the faces.
  - **Feedback:**
    - Orange translucent slabs on the selected faces in 3D, rebuilt only
      when the selection or the document changes.
    - A dashed orange outline in an orthographic pane when a selected face
      points along that pane's hidden axis.
    - A six-face net in the inspector, laid out as an unfolded box. Each
      cell shows the face key and its texture, and clicking a cell toggles
      the face, which reaches faces the camera can't see.
  - **Applying:** with faces selected, picking a texture changes only those
    faces, as one undo step. A face that already has an alignment keeps it
    and only its texture changes. A new face override starts at natural
    alignment, so a texture without a known image size is refused with a
    status message.
  - **Eyedropper:** Alt+click makes the face's texture the current texture,
    with its size when the face has an override. The face selection stays
    as it was.
  - **Tests:** `faceKeyFromNormal` for the six axis normals and a tilted
    one; a DOM test that picks a face in 3D, adds one from the net,
    textures just those two, keeps an existing rotation on retexture,
    samples with Alt+click, and clears on a plain click. Writing the test
    turned up a real bug: the view-save status overwrote the face-selection
    message, so the status is now set after the save.
  - **Browser check** (headless Edge, Room Template): Ctrl+Shift+click
    picked +Z on the ceiling's top, +X on the east wall and +Y on the north
    wall. The net marked the picked face, and the XZ pane drew the dashed
    outline for a +Y face.
- 2026-10-03: WO-T6 done.
  - **Operations** (`09a38b28`, in `FaceUv.ts`):
    - `matrixToFace` reads shift, scale and rotation back out of a face
      matrix, with shift reduced to one repeat and rotation to [0, 360).
    - `fitFace` puts one repeat across a face from its projected extents.
    - `matchFace` continues a face's texture over the edge it shares with
      an adjacent face. It folds the target flat into the source's plane
      around that edge and reads the resulting matrix back as parameters.
      Every box face's axis basis has the same handedness relative to its
      outward normal, so the folded matrix is always a scaled rotation and
      decomposes exactly, at any rotation.
    - `wrapFaces` chains matches around the box, reaching the opposite
      face through a selected face between them.
  - **Panel** (`ef7e0a17`, `FaceAlignmentPanel.ts`): built apart from
    `EditorSession.ts` while the toolbar restyle was in that file.
    - Fields: shift U/V (nudge 8 texels), scale U/V (nudge 0.05) and
      rotation (nudge 15°). A field all selected faces agree on shows its
      value; a differing one is blank ("mixed"), and typing a value sets
      it on every face. A nudge adds its step to each face's own value.
    - Fit, Natural, and Wrap from the first selected face. The panel
      builds edits only; the session applies each to every selected face
      as one undo step.
    - A selected face still on the brush's fixed alignment has no image
      size to align against, so the panel locks and says why.
  - **Plan deviation:** "match neighbour" is Wrap, within one brush. Two
    coplanar faces on different brushes already continue with identical
    parameters, because ST is a world-space projection.
  - **Inspector:** the face net and the panel moved below the brush form,
    under a Faces heading, since forms can't nest.
  - **Tests:** ST continuity along the shared edge for every adjacent pair
    with a rotated, shifted, non-square source, and that the texture runs
    on past the edge rather than mirroring. A mutation that flipped the
    fold direction failed both. Panel and session DOM tests cover nudge,
    typed values, undo as one step, wrap, and the lock.
- 2026-10-03: WO-T7 done.
  - **Geometry** (`3ba25f3e`, `TexturedPreview.ts`): every brush face
    as a quad, batched by shader, with UVs straight from the face ST. The
    engine draws BSP ST unflipped on textures uploaded top row first, so
    the preview does the same.
  - **Materials** (`PreviewTextures.ts`): one StandardMaterial per shader
    in the editor's own scene. A material shows a flat colour at once
    (magenta for a missing image) and gains the decoded image when it
    lands. Transparent shaders alpha-test. Images are capped at 512 px to
    bound GPU memory.
    - Plan deviation: `PK3TextureLoader` is not used, because it is a
      singleton bound to the game's scene and cache. Decoding moved from
      the thumbnail module into a shared `TexturePixels.ts`.
  - **Toggle:** a Solid/Textured button in the 3D pane's corner. Solid
    stays the default, so opening the editor still never loads the
    catalog. In Textured mode the brush boxes remain as the pick, edge and
    selection layer: see-through, tinted for a selection or a brush entity,
    and pulled forward so they don't z-fight.
  - **Browser check** (headless Edge, Room Template, real packages):
    `boqu/boqu_window` applied to the east wall, its +X face picked and
    rotated 15°. The textured preview drew the real `blx_grid` and window
    images with the rotation visible.
    - The first shots showed the selected face as solid orange. Switching
      view modes rebuilt the meshes but not the face overlays, which kept
      the Solid-mode opacity. The toggle now redraws, the overlay is
      lighter in Textured mode, and the brush tint steps aside while faces
      are selected. The session test now switches modes with a face
      selected.
  - **Proof against MakeBSP:** a probe box with a rotated, shifted source
    face, two faces wrapped from it, a fitted face, a 90° face and a
    fixed-alignment face compiled with the local MakeBSP. All 24 compiled
    vertices matched the preview vertex at the same position: worst
    |UV − ST| modulo 1 was 1.05e-7.

## M2 3D view: flycam navigation and view modes (plan, 2026-10-03)

The 3D pane used an orbit camera: right drag orbited a target point, middle
drag panned, and the wheel zoomed toward that point. Getting into a room
or along a corridor meant repeated orbit, pan and zoom, and the orbit point
was rarely where the mapper was looking. Radiant-family editors fly the
camera instead, and mappers expect that.

### Controls

The camera is a flycam: a position, a yaw and a pitch. Left click keeps
its meaning in 3D (select; Ctrl+Shift picks a face, Alt samples one).

| Input | Where | Effect |
| --- | --- | --- |
| Middle or right drag | Anywhere in the 3D pane | Mouse look: yaw and pitch follow the mouse. |
| Middle or right click (no drag) | 3D pane | Toggles free look: the pointer is captured and mouse movement looks around until another middle/right click or Escape. |
| `W` / `S` | Pointer over the 3D pane, or free look | Fly forward / back along the view direction, held for continuous movement. |
| `A` / `D` | Same | Strafe left / right. |
| `Space` / `C` | Same | Rise / sink straight up and down, as in the game. |
| `Shift` | Held with the above | Fly three times faster. |
| Wheel | 3D pane | Step forward / back along the view direction. |
| `F` / `Shift+F` | Editor | Frame selection / all: the camera keeps its direction and backs off until the bounds fit. |

The fly keys don't collide with the tool shortcuts (`B`, `V`, `E`, `T`,
`F`, `Delete`): none of W, A, S, D, Space or C is bound. Holding a fly
key while the pointer leaves the 3D pane stops the movement, as does losing
window focus, so the camera never keeps drifting.

Pitch is clamped short of straight up and down so yaw stays well defined.
Speed is in Quake units per second (400, or 1,200 with Shift), so movement
matches the map's scale at any frame rate.

### View modes

A three-way switch in the 3D pane's corner: **Brush | Textured |
Wireframe**. Textured is the default; it draws each face's image with its
alignment (WO-T7). Brush shows the solid owner-coloured boxes. Wireframe
shows only brush edges, for seeing through walls; the selection and brush
entities keep their colour in the edges. Until the catalog has loaded,
Textured shows the brush colours, so opening the editor never waits on it.
The mode is saved with the view.

### Saved view

The view state stores the flycam pose (position in Quake units, yaw and
pitch in degrees) and the view mode. A draft saved with the old orbit
camera keeps its view: the orbit's eye position and look direction are
converted to a pose on load.

### Work orders

| WO | Scope | Depends on | Parallel | Size | Agent | Status |
| --- | --- | --- | --- | --- | --- | --- |
| WO-N1 | Flycam math and controller: pose, look, fly, frame, orbit conversion; mouse look, free look, held keys, wheel | none | yes | 3 | Opus 5.5 | todo |
| WO-N2 | Session hookup: replace the orbit camera, saved pose and migration, framing, per-frame movement | N1 | no | 3 | Opus 5.5 | todo |
| WO-N3 | Brush / Textured / Wireframe switch, Textured by default, saved mode | none | yes | 2 | Opus 5.5 | todo |
| WO-N4 | Browser check of navigation and modes; docs and changelog | N2, N3 | no | 1 | Opus 5.5 | todo |

- **N1 proof:** unit tests on the pose math (look clamps, fly directions in
  Quake axes, framing keeps direction and fits the bounds, the orbit
  conversion reproduces the old eye and direction) and DOM tests of the
  controller's drag, click-to-toggle, keys and wheel.
- **N2 proof:** the session's existing face-picking tests still hit the same
  face from the default pose; framing and the saved pose round-trip; an old
  orbit view loads.
- **N3 proof:** DOM tests of the switch and each mode's materials.

### Progress log



These are proposals, not commitments or current SHAGGED features. [NetRadiant Custom](https://github.com/Garux/netradiant-custom#features) already offers capable texture painting, entity navigation, region builds, and 3D editing; the opportunity here is to connect authoring, compile diagnostics, and SHAG playtests in one UI. [Blender's asset browser](https://docs.blender.org/manual/en/4.4/editors/asset_browser.html) is a useful precedent for reusable authoring assets. “Earliest” below means the first sensible milestone after the required substrate exists, not a delivery promise.

| Author-facing feature | What the mapper does / sees | Earliest | Architecture seam and honest limit |
| --- | --- | --- | --- |
| Map Health tray | Click a warning such as invalid brush, missing shader, unsupported entity, duplicate target name, or no spawn; all four views frame and highlight the object. | M2 | Pure document validators plus an asset/entity catalog. Warnings must distinguish exporter errors from runtime advice. |
| Clickable compile diagnostics | Click a MakeBSP log message to select the implicated brush/face or show a leak path over the views. | M3+ | `MapWriter` should optionally emit object/face-to-source-line provenance; server stores logs by build ID. Compiler messages may lack reliable positions, so unmatched messages remain plain text. |
| Draft vs compiled ghost | Toggle translucent overlays showing which brushes/entities changed since the last playable build; status names both revisions. | M3+ | Compare immutable document snapshots by stable ID. The ghost is a source diff, not a promise about final BSP geometry. |
| Smart measurements | Pin distances, brush dimensions, door clearances, and height differences while drawing, with optional snap guides. | M2 | View-independent Quake-space measurements and transient overlays. Clearance against gameplay collision needs compiled data. |
| Entity-link canvas | See target/targetname connections as lines and a compact graph; click a broken link to edit the relevant key. | M2+ | Preserve arbitrary entity keys; parse known link conventions without rewriting unfamiliar classes. |
| Camera bookmarks and review tour | Save named 3D viewpoints and click through them during review; optionally export screenshot pairs before/after a build. | M2+ | Bookmarks live in editor metadata, never `.map` entities. Screenshots need viewport/render capture but no document change. |
| Material brush and palette | Paint selected faces with a shader, sample one from the scene, browse recent/favorite shaders, and preview missing assets before export. | M2+ | Face identity and UV data must survive edits; shader browser queries mounted PK3/shader assets, with fallback when a preview is unavailable. |
| Reusable room stamps | Drag a saved doorway, staircase, arena corner, or pickup arrangement into a pane; edit its parameters before committing one undo step. | M4+ | Store a versioned editor recipe or prefab source, generate ordinary brushes/entities, and make ID/target-name remapping explicit. Export only compiler-supported geometry. |
| Parametric shape handles | Adjust arch radius, stair count, bevel depth, or corridor width in the inspector while watching every pane update. | M4+ | Recipes remain editable in the draft and regenerate geometry deterministically; warn before destructive conversion to freeform brushes/patches. |
| Region test build | Draw a temporary region around a room and request a shorter compile/test cycle, with a clear “region build” badge. | M3+ spike | Requires proof of MakeBSP region behavior or a safe temporary `.map` generator, including sealing and spawn rules. Never replace the full-map build's ready status. |
| Spawn and sightline explorer | Pick two spawns or points and see approximate visibility, distance, and route notes; later compare against compiled collision/PVS. | M3+ | Raw-geometry ray checks are labeled preview estimates. Authoritative collision/PVS overlays require a compiled build and build-matched coordinates. |
| Playtest observations | During a SHAG playtest, drop a location note (“too dark,” “stuck here”) and see it as a pin after Return to Editor. | M3+ | Store note position, map ID, and build ID outside `.map`; transform/flag pins when source geometry changes. No live editor/game world is required. |
| Movement and combat heatmaps | Overlay death, pickup, route, or traversal density from recorded playtests to find dead zones and confusing paths. | Later | Ingest consented gameplay/demos by build ID, aggregate server-side, and draw read-only overlays. Never mix telemetry into canonical `.map` source. |
| Build comparison board | Choose two builds and compare screenshots, compile warnings, entity counts, and playtest notes from matching bookmarks. | Later | Immutable build records, deterministic camera bookmarks, and retained artifacts; metrics must identify their source and build. |

**Architecture check:** these ideas fit the proposed document → derived preview → export/build separation if M1 keeps stable object IDs, one undoable transaction per edit, and a versioned draft. M1 box faces can use stable axis keys (`+X`, `-X`, and so on); arbitrary convex faces will need persistent IDs before face painting or clickable face diagnostics. The exporter should be able to return a source-location map alongside `.map` text without embedding editor metadata in the file. Derived overlays (health, measurements, ghosts, links, heatmaps) need a view-layer interface that accepts Quake-space annotations; they should not mutate brushes just to display information. Reusable recipes and bookmarks belong in editor metadata with a deliberate flatten/export rule. Build-specific notes and telemetry belong to immutable build IDs, so an older result is never silently presented as current.

The M3 server Save contract needs one small extension before these features: save an optional, schema-versioned **editor sidecar** beside each canonical `.map` revision. It holds the corresponding editable document snapshot with stable IDs, groups/recipes, bookmarks, and other editor metadata; the `.map` remains the compiler input and standalone export. For SHAGGED-authored maps, the server can run the shared pure writer against the snapshot and reject a sidecar whose generated source differs from the submitted `.map`. `localStorage` remains the unsaved recovery copy. Without a sidecar, reopening a server-saved `.map` would regenerate IDs and break reliable ghost comparison and note attachment. An external `.map` without a sidecar remains source-only until the later lossless importer can create a matching editable snapshot. This is a future contract, not an M1 backend requirement.

**Best early bets:** Map Health, smart measurements, and camera bookmarks improve day-to-day mapping before a compiler backend exists. Clickable compile diagnostics and draft-vs-build ghosting are the most distinctive additions once M3 works. Region test builds and telemetry are valuable but should wait for measured compiler behavior and real playtest data.

## Simplified modular builder mode (future)

This could be an especially approachable second way to author the **same** map document: a Block Builder palette beside the normal Brush tools. Authors drag room pieces into the 3D or orthographic view, see a ghost snap to a compatible edge, rotate in 90° steps, and click to place. Switching between Block Builder and Freeform never converts or discards geometry. Start after the M1 box/document/export contract is working; box-only modules could arrive in M2+, with arches/curves joining after M4.

| Babylon capability | Useful role in SHAGGED | Boundary |
| --- | --- | --- |
| [GizmoManager](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Gizmos/gizmoManager.ts) and [position snap controls](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Gizmos/positionGizmo.ts) | Show move/rotate handles on a selected placed module; Babylon 9.17's installed types expose `positionGizmo.snapDistance` and manual `attachToMesh`. | Use manual attachment and translate gizmo movement back into an integer Quake-space placement proposal. SHAGGED, not the gizmo, decides socket compatibility, collision, and the committed document transaction. Prototype gizmos with four camera viewports before relying on them. |
| [Mesh instances](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/copies/instances.md) | Draw repeated, identical block-preview meshes cheaply while keeping each placement transformable. | Each instance still maps to a stable editor ID. Begin with ordinary meshes/instances for easy picking; consider thin instances only after profiling large maps and their picking behavior. Rendering instances are never `.map` instances. |
| [AssetContainer templates](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/importers/assetContainers.md) | Later, keep decorative glTF model previews loaded once and instantiate them into the editor scene. | A glTF preview does not become compile-ready brush geometry automatically. Model entities need their own tested `.map`/runtime contract; v1 modular blocks are typed brushes. |

**First kit:** floor tiles (64×64, 128×128, 256×256 Quake units), matching wall segments, a doorway surround, and a simple platform or stair made from boxes. These sizes are proposals, not a fixed engine unit system. Pick one kit base cell (for example 64 units); every footprint, height, and socket coordinate is an integer multiple of its subdivision. A 128-unit side can expose two separate 64-unit sockets, allowing two 64-unit pieces to attach without a half-cell offset. Opening/door sockets carry an opening kind and full cross-section so a wall cannot silently fill a doorway.

The palette shows a thumbnail, footprint/height, and connection type. While hovering, draw a translucent module ghost in every pane, highlight the candidate socket and its mate, show its snapped XYZ and quarter-turn, and distinguish valid, blocked, and unmatched placement with both color and text. `Q`/`E` rotate by 90°; `Alt` temporarily disables socket magnetism but keeps the grid; clicking commits one undo step. A brush drawn freeform can sit beside modules. No arbitrary scaling in Block Builder: choose a size variant or edit the module's parameters, because free scaling can break door clearances and connector alignment. The normal inspector can offer **Detach to Brushes** for a module the author wants to edit freely.

The pure authoring model needs a versioned `PrefabDefinition` (local brush parts, integer footprint, anchor, sockets, allowed quarter-turns, shader defaults) and `PrefabInstance` (stable ID, definition ID/version, integer Quake translation, quarter-turn, parameters). Socket placement tries compatible opposing normals, matching kind and cross-section, and exact grid alignment; otherwise it falls back to the base grid. Positive-volume overlap with existing solids is blocked in simplified mode unless a definition explicitly allows it; face-to-face contact is fine. The preview also flags gaps or mismatched heights, while a later MakeBSP check remains the final seal/compile proof.

On export, a pure `PrefabExpander` turns each instance into ordinary brushes (and later supported entities/patches), deriving stable child IDs from instance and part IDs. Then the existing `MapWriter` serializes the expanded document through the same Washoi `brushDef` path. Preserve the editable instance, definition version, and parameters in the local draft and later editor sidecar; the `.map` contains only compiler-understood output. A prefab-library update must never silently reshape an old map: pin each placed instance to its definition version and offer an explicit update preview. A 90° Z rotation of a box kit stays axis-aligned, so the first kit does not require arbitrary-convex/CSG export.

**Proof before committing to the mode:** place 64- and 128-unit pieces along the same edge, rotate every variant, undo/redo, save/reopen, export twice for identical bytes, and compile a sealed sample room. Test intentional doorway openings and accidental overlaps separately. This proves modular snapping and map output, rather than only an attractive Babylon ghost.

## Console launch and mode lifecycle

Recommended console contract for the first milestone:

```text
developer 1
editor open          // `editor` can be a shortcut
editor status
editor close
```

`editor` should be an engine command with `developer: true`, help text, and subcommands. The developer gate follows the existing `map` authoring/debug path; it is a product choice to revisit if map making becomes a normal player feature. `editor open` creates or resumes an editor session; a repeated call focuses the current session instead of allocating another scene. `editor close` returns to the previous UI and rendered scene. The editor also needs a visible Exit control. `editor status` reports open/closed and draft state. The console remains available in editor mode, so the same command can close it. Unknown subcommands and unavailable visual hosts should return `fail(...)` for correct headless batch exit status.

Use the existing [gameplay launcher registration pattern](../manual/guides/map-launching.md) as a small boundary: `EditorCommand.ts` obtains a registered `EditorLauncher` (`open`, `close`, `status`), while `src/main.ts` registers the browser implementation after the engine, canvas, and scene are ready. The command can be auto-discovered in every composition without importing DOM/Babylon editor UI in the headless CLI. In `cli:game`, `editor status` may report unavailable and `editor open` should fail clearly. This is a **console command integration**, not a separate downloadable console plugin package; SHAG's present extension point is the command registry.

The browser host should own one explicit mode state (`game`/`editor`) in the existing render loop: update/render only the active composition. The editor owns its entire scene while active; the current base FPS scene may stay allocated and idle because `src/main.ts` captures its scene/player in a fixed closure. This does not mean an active game runs beside the editor. The host must stop player updates and gameplay input while editing, release pointer lock, and clean up editor observers/cameras on exit. `editor close` returns to the prior lobby/menu composition; Playtest follows the separate compile-and-`map` handoff below. A connected multiplayer match needs an explicit policy before implementation (recommended first slice: refuse `editor open` until that match ends). Do not use `scene empty` as a host: its command owns and replaces the render loop and initializes camera/physics state for BSP inspection.

This adds a small but real integration task beyond the standalone-editor estimate: command registration is easy; reversible mode handoff, input ownership, and preserving the active session need a focused prototype. Put console launch/close in the first vertical slice rather than wiring it after export.

## Architecture review

The proposed ownership split is sound: the engine owns the console command and browser composition host; the editor owns its document, tools, and Babylon preview; the Node service owns canonical files and compiler processes; the existing gameplay launcher owns Playtest. Keep one active update/render composition. An idle base FPS shell scene can remain allocated while the editor is open; a playtest match itself must be ended before Return to Editor. A single Babylon scene with four cameras is a prototype choice, subject to pane picking and overlay tests, rather than a permanent architecture requirement.

```mermaid
flowchart LR
  subgraph Browser[Browser / SHAG engine]
    Console[Console: editor open/close] --> Host[Composition host]
    Host --> Editor[SHAGGED document + four-view preview]
    Editor <--> Draft[localStorage draft + UI state]
    Host --> Game[Existing map launcher + gameplay]
  end
  subgraph Node[Node / SHAGGED service]
    API[Map + job API] --> Store[Canonical .map revisions + optional editor sidecars]
    API --> Jobs[Shared compile job service]
    CLI[shagged:compile CLI] --> Jobs
    Jobs --> Tools[MakeBSP / MakeLight]
    Tools -->|successful build| Artifact[Compiled revision]
    Artifact --> Ready[Playtest readiness gate]
  end
  Editor -->|save / compile / poll| API
  Ready -->|exact build resolvable by client and server| Game
  Game -->|Return to Editor| Host
```

The readiness gate is a **contract**, not a BSP delivery design: it must report the exact built revision, a runtime map identifier accepted by `map <name>`, and confirmation that the browser client and lobby-spawned game server will resolve that build. `MakeBSP` exit code 0 alone is only **compiled**. If indexing, delivery, or verification fails, status remains **compiled but not playable** and Playtest stays disabled. This also prevents a same-name map already in a PK3 or cache from being mistaken for the new build. M3 can choose immutable runtime names or explicit index/cache invalidation after a delivery spike.

Before compilation, the editor saves a snapshot to the server with an expected revision. The compile request names the returned saved revision, never the mutable in-memory draft. If saving conflicts or fails, compilation does not start. Before Playtest, checkpoint the draft and UI state to `localStorage`; if that write fails, keep the editor open and offer a fresh `.map` export or retry so the user can retain the working state. These gates make Save, Compile, and Playtest distinct operations with visible outcomes.

## Playtest handoff: save editor, compile, launch game, return

The editor owns the active scene while it is open. It previews the editable `.map` document in four views; there is **no separate raw gameplay world** and no live raw/BSP hot swap. Playtest leaves the editor, starts the normal compiled-map game flow, and returns by rebuilding the editor from saved state. This reduces scene and input lifecycle work while retaining the important edit → compile → test → edit loop. The sequence below shows the successful M3 path; each failed gate stops before the next step and leaves the editor open.

```mermaid
sequenceDiagram
  actor Mapper
  participant Editor as Browser editor
  participant Draft as localStorage
  participant API as shagged:server
  participant Build as Compile job
  participant Game as Existing map launcher
  Mapper->>Editor: Compile current draft
  Editor->>API: PUT .map with expected revision
  API-->>Editor: Saved revision N
  Editor->>API: POST compile revision N
  API-->>Editor: Job ID
  API->>Build: Run MakeBSP / MakeLight on immutable N
  loop Poll job
    Editor->>API: GET job status
    API-->>Editor: Stage, logs, revision, outcome
  end
  Build-->>API: Compiled artifact
  API->>API: Verify exact build resolves for client + server
  API-->>Editor: Playable runtime name + build ID
  Mapper->>Editor: Playtest
  Editor->>Draft: Checkpoint document + UI state
  Editor->>Editor: Dispose editor scene and release input
  Editor->>Game: map runtime name
  Mapper->>Game: Return to Editor
  Game->>Editor: End match and reopen editor
  Editor->>Draft: Restore document + UI state
```

### First milestone controls

Show **Compile**, **Compile Status**, and **Playtest** in the editor toolbar from M1, alongside Save/Export and Exit. The first milestone only has to make their state honest: Compile may show `Server compile not connected yet` while still offering `.map` export; Compile Status shows `Not configured` until a job API exists; Playtest is disabled until the server reports a compatible compiled map ready for SHAG's normal map path. Do not display a fake success or launch an older map under the same name without saying so. A later milestone wires Compile to the server-side CLI and Playtest to the normal launcher.

The intended completed flow is: save a numbered `.map` revision through `shagged:server`; request its compile job; the shared Node compile service starts MakeBSP and then MakeLight as child processes; the editor follows job status and errors; the server verifies that the exact compiled revision is playable; persist editor state; tear down the editor scene; invoke the existing `map <name> [gametype]` gameplay launcher with the returned runtime name; then expose **Return to Editor** in the game/escape UI and as `editor return`. Return ends the playtest match, unloads gameplay, reopens SHAGGED, and restores its state. The game uses its normal spawn and camera behavior. We do **not** promise camera-pose continuity across editor and gameplay.

### Saved editor state

Use one versioned `localStorage` record per map for the authoring document and UI session: stable map ID/name, document revision, brushes/entities/patches/groups, current selection/tool, grid and snap settings, 3D camera pose, three orthographic pan/zoom states, pane layout, preview mode, and a return-to-editor marker. Write at deliberate checkpoints and a short debounced interval; flush synchronously before Playtest/Exit. On return, validate the schema and restore the last good draft. Keep a separate downloadable `.map` export; `localStorage` is convenient recovery, not the only durable copy and not a place for BSP binaries. Handle quota/write failures visibly and leave the in-memory draft usable.

Compile jobs use an immutable copy of a server-saved `.map` revision and a server-issued job ID. The server owns process execution, logs, exit status, and artifact/readiness state; the editor follows status by polling initially and can reconnect to the job after a UI reload. If the draft changes while a build runs, keep showing `Compiled revision N; draft revision N+1` and require an explicit choice before playtesting stale output. A failed build leaves the draft and last successful status intact, but a prior successful build must be labeled with its own revision. Automatic background compile can be added after timings and process cancellation are understood; the first working integration can be button-triggered.

### The remaining game-path boundary

`map <name>` is not a local scene load: `FpsMapLauncher` asks the lobby to spawn a server and the client then joins it. The server-side CLI can own the MakeBSP build and compiled artifact, but the browser client and spawned game server must both be able to resolve that same revision before `map <name>` succeeds. SHAG currently indexes BSPs inside PK3s. The exact delivery/index step is **deferred from M1**, as requested; M3 must prove it before enabling Playtest. No browser-side MakeBSP execution or separate raw gameplay loader is planned.

The active application render loop currently always updates the player and renders the FPS scene. Editor takeover still needs a small composition switch, plus reliable disposal/recreation on entry, Playtest, and return. It does **not** need two simultaneously live worlds, staged BSP replacement, or collision-backend hot swapping. A live match should be left before opening the editor; Playtest creates its own normal development match.

**M3 acceptance:** build a room, save editor state, compile it, see the correct revision/status, enter it with Playtest using normal `map <name>`, exit through Return to Editor, and recover the same draft, selection, cameras, layout, and view mode. Repeat the cycle and verify no extra render loops, input listeners, servers, or scene resources remain. Test failed compile, stale revision, unavailable map, and `localStorage` quota failure with clear messages.

## Proposed SHAGGED backend and CLI

Yes: a separate editor service is a good fit. `lobby:server` shows how this repo starts a long-running Node service; SHAGGED would have its own process and small API. The browser still owns the interactive document, four views, selection, and preview. The backend owns durable `.map` files, MakeBSP/MakeLight processes, job status/logs, and eventually the handoff that makes a compiled map playable. Do not put editor build endpoints inside the lobby server merely because the lobby later starts the playtest match.

Available backend package scripts:

```text
npm run shagged:server
npm run shagged:compile -- <mapname>
```

`shagged:compile` reads a server-saved map by name and uses the same compile service as the API; it is useful for headless validation and CI. With npm, the `--` separator forwards `<mapname>` to the script. The HTTP server should call that shared compile service directly, not shell out to `npm run shagged:compile`, so logs, cancellation, and process ownership stay with one job manager. That service invokes MakeBSP and MakeLight using explicit argument arrays and the existing Washoi FAST recipe.

The current service binds `127.0.0.1:9010` by default, writes beneath
`server-data/shagged/maps`, and accepts only configured browser origins.
`GET /api/status`, `GET /api/maps`, `GET /api/maps/:name`, and
`PUT /api/maps/:name` work now. PUT requires `source` and `expectedRevision`,
with an optional schema-versioned `sidecar`; a sidecar must serialize to the
exact submitted `.map` bytes. The store writes an immutable source snapshot
and replaces the current-revision pointer after the full write. Stale saves
return HTTP 409. `POST /api/maps/:name/compile` and
`GET /api/compiles/:jobId` use the shared job manager. Duplicate requests
for one source revision/quality reuse a job; failed jobs may be retried.
The API returns `compiled` after the FBSP v1 header check, with
`runtimeMapName: null` until game-side delivery is implemented. Jobs and
logs are not persisted across a server restart yet. A local `--check-config`
reports the resolved compiler setup and exits nonzero when it cannot run;
Save/Open can still run in that case.

### Compiler configuration and server boundary

Resolve one Node-only `CompilerConfig` at process startup; both `shagged:server` and `shagged:compile` call the same resolver and shared job/recipe code. Proposed precedence is **CLI flag → `SHAGGED_*` environment variable → documented local default**. No browser setting or compile request may choose an executable, arbitrary command-line argument, media path, or output directory. Start with the Washoi profile only; other game profiles require their own compile proof later.

| Setting | CLI flag / environment | Proposed default | Startup behavior |
| --- | --- | --- | --- |
| MakeBSP executable | `--makebsp-bin` / `SHAGGED_MAKEBSP_BIN` | `makebsp` resolved from the server's `PATH` (`makebsp.exe` on Windows) | Resolve and report availability. If missing, Save/Open still work but Compile is unavailable. Binary version capture is still planned. |
| MakeLight executable | `--makelight-bin` / `SHAGGED_MAKELIGHT_BIN` | `makelight` from `PATH` (`makelight.exe` on Windows) | Required for a full playable build; missing binary disables Compile/Playtest readiness. |
| Toolchain root containing `makebspdata/washoi.json` | `--toolchain-root` / `SHAGGED_TOOLCHAIN_ROOT` | directory containing the resolved MakeBSP executable | Required for the Washoi profile; also used as each tool's working directory. |
| Media root for `-fs_basepath` | `--media-root` / `SHAGGED_MEDIA_ROOT` | repository `public/data` | Resolve to an absolute directory and verify it exists; the clean checkout may lack external assets. Do not add `-fs_game` for the current Washoi layout. |
| Canonical map store | `--maps-root` / `SHAGGED_MAPS_ROOT` | repository `server-data/shagged/maps` | Resolve outside browser-served assets; create/check the directory before accepting Save. |
| Server listener | `--port` / `SHAGGED_PORT` | `9010` on loopback | API port only; independent of lobby port `9000`. CLI compile does not listen. |
| Allowed browser origin | repeatable `--ui-origin` / comma-separated `SHAGGED_UI_ORIGIN` | local Vite origins `http://localhost:3000` and `http://127.0.0.1:3000` | Allow only configured origins for browser API calls; do not accept arbitrary cross-origin requests. |
| Default build quality | `--default-quality` / `SHAGGED_DEFAULT_QUALITY` | `fast` | UI may request `fast`, `default`, or `release`; unknown values fail before spawning a process. |

Example local override (proposed scripts, not yet implemented):

```text
npm run shagged:server -- --makebsp-bin C:\tools\makebsp.exe --makelight-bin C:\tools\makelight.exe --media-root ./public/data --maps-root ./server-data/shagged/maps --port 9010
npm run shagged:compile -- mymap --quality fast --makebsp-bin C:\tools\makebsp.exe --makelight-bin C:\tools\makelight.exe
```

The recipe follows `editor/gamepacks/washoi.game/default_build_menu.xml` rather than a browser-supplied command string:

| Quality | MakeBSP arguments after `-game washoi -fs_basepath <media-root>` | MakeLight arguments after the same prefix |
| --- | --- | --- |
| `fast` | `-leaktest -fast -samplesize 8 <snapshot.map>` | `-fast <snapshot.map>` |
| `default` | `<snapshot.map>` | `<snapshot.map>` |
| `release` | `<snapshot.map>` | `-upscale <snapshot.map>` |

The server runs binaries with argument arrays and no shell, from a controlled job workspace containing an immutable saved revision. Jobs for the same map must not overwrite one another's input or output; return an existing job for a duplicate map/revision/quality request or queue a separate build as policy dictates. Record the resolved binary identity (and version if available), media root, quality, exact argument arrays, exit codes, and artifact ID in job metadata/logs. Both entry points should support `--help` and a one-shot `--check-config` that reports resolved paths/profile/media and exits nonzero if a full compile cannot run. P0 must first prove how the chosen MakeBSP distribution finds `makebspdata/washoi.json` and where it writes BSP files; add a tested toolchain-root flag only if that distribution needs one. Do not invent a working directory assumption before that probe.

The UI calls `GET /api/status` for `saveAvailable`, `compilerAvailable`, supported qualities, and a short reason when unavailable; it does not receive private executable paths. It sends `POST /api/maps/:name/compile` with only the **saved source revision** and a quality tier, receives a job ID, and polls that job. The server refuses a missing revision or unavailable compiler immediately. `compiled` means the tools completed; `playable` still waits for the exact-build client/server discovery gate described above. This keeps a disabled Compile button explainable without requiring the browser to understand MakeBSP flags.

For local browser development, `ShaggedApi` receives a base URL from `VITE_SHAGGED_API_URL`, defaulting to `http://127.0.0.1:9010`. The Node service binds loopback and permits only the configured UI origin(s); a nonlocal browser or deployment needs an explicit URL/origin setup later. Keep this address out of the editable map document. If the service is offline, the editor still opens, edits, saves its local draft, and exports `.map`; Server Save/Compile/Playtest show a connection error and retry. The client must not silently substitute an older compiled build. A same-origin proxy can replace the direct local URL when the app's deployment path is designed, without changing map or job APIs.

Implementation status: the browser editor now has Server Save, Compile, and a polled status/log panel. A local draft's stable ID maps to `draft_<uuid without hyphens>` on the server, so renaming a draft does not rename its compiler source. The last server revision lives in the local view record and every save checks the current server revision before writing. Compile saves the exact current document first; a finished job remains `compiled`, with Playtest disabled until build delivery is implemented. Server Open and conflict resolution UI are later work.

API shape (Save/Open and Compile/Status endpoints implemented; playable readiness still planned):

| Request | Purpose |
| --- | --- |
| `GET /api/status` | Report Save/Compile availability, supported quality tiers, and a concise unavailable reason without exposing binary paths. |
| `GET /api/maps` and `GET /api/maps/:name` | List/load server-saved `.map` source, its revision, and matching editor sidecar when available. |
| `PUT /api/maps/:name` with `.map` text, expected revision, and optional versioned editor sidecar | Commit source and matching sidecar as one revision only after both writes succeed; return new revision or a conflict. The `.map` alone remains sufficient for MakeBSP. |
| `POST /api/maps/:name/compile` with revision and quality | Start one immutable compile job for that saved revision; return job ID immediately. |
| `GET /api/compiles/:jobId` | Return queued/running/failed/compiled/playable state, stage, short log tail, source revision, build ID, and runtime map name when playable. Polling is enough initially; streaming can come later. |

Use a configured maps root and validate names as identifiers, not paths. The server is the canonical saved `.map` source once this API exists; `localStorage` remains the fast recovery copy of the unsaved draft and editor UI state. Show a dirty/revision indicator, and do not overwrite a newer server revision silently. For a local development service, bind to loopback initially; remote access and authentication are a separate decision. The game-facing BSP installation/discovery step remains an M3 integration question, not part of this API's M1 UI skeleton.

Implementation boundary: `src/cli/shagged-server.ts` and `src/cli/shagged-compile.ts` can be thin entry points over a Node-only map store and compile-job service. Keep Node filesystem/process imports out of the browser editor package. M1 can ship the toolbar and `localStorage` recovery without running this service; the next backend slice can add Save/Open and a real Compile Status, followed by compile jobs and Playtest.

## Milestone 1: draw brushes and export `.map`

### Workspace

Use a resizable 2×2 grid with one 3D perspective view and three labeled orthographic views: XY top, XZ front, YZ side. All panes show the same document, selection, and brush outlines. Each orthographic view has independent pan and zoom and a grid scale indicator. A single Babylon editor scene with four cameras and camera viewports is a plausible first implementation; input routing must explicitly map pointer coordinates to the correct viewport. DOM splitters, labels, toolbar, and property fields can sit over the canvas. If viewport picking or per-camera overlays prove awkward, separate canvases are a fallback, not an initial commitment.

Proposed default arrangement: full-width toolbar at top; perspective upper-left, XY upper-right, XZ lower-left, YZ lower-right; a narrow brush inspector to the right; status bar below. Pane dividers resize the views and their camera viewports together. Remember divider positions per draft, and provide a Reset Layout action so a collapsed pane can be recovered.

The document uses Quake X/Y/Z coordinates; each orthographic pane only changes projection. Fix the pane axes before implementing drags:

| Pane | Horizontal | Vertical | Hidden dimension set by work plane / numeric extent |
| --- | --- | --- | --- |
| XY top | X | Y | Z |
| XZ front | X | Z | Y |
| YZ side | Y | Z | X |

Define positive screen directions and the Quake-to-Babylon transform once in the view layer, then test a box with unequal X/Y/Z lengths in every pane to expose mirrored axes. Hit-test splitters and toolbar first, then a pane; convert pointer CSS pixels using the canvas bounds and device pixel ratio before camera picking. A drag captures its starting pane and work plane until pointer-up, even if the pointer crosses a splitter.

Prefer a simple, unlit editing preview over the gameplay renderer. Render each convex brush as faces/edges in 3D and projected outlines in side views; selection highlights are editor-owned objects. Do not run BSP culling, baked lighting, postprocessing, collision, or the gameplay camera stack in this workspace. The source document, rather than Babylon meshes, is authoritative.

### Editing interaction

1. Select **Brush**; drag a rectangle in any orthographic pane. Snap its two visible dimensions to a configurable grid (start at 8 or 16 Quake units).
2. Give the hidden axis a default one-grid span from the pane's snapped work plane toward its positive axis. Show its extents in the other two panes; drag a face or edit numeric min/max fields to set height/depth precisely.
3. Support select, move, resize, duplicate, delete, pan, zoom, and undo/redo. One active selection is enough at first. Keep all changes as document commands so one gesture becomes one undo step.
4. Let the user choose a face shader from a short known-good palette; one shader on all six faces is acceptable initially. Require a nonempty shader path and show missing assets clearly.
5. Create `worldspawn` automatically. M1 may expose one optional numeric test-spawn origin/angle and export it as `info_player_deathmatch`; this is a narrow fixture aid, not the general entity-placement tool planned for M2. A sealed six-wall room can be a starter template for compile verification; a single free-standing box may compile yet leak and is a poor whole-map test.

For milestone 1, **axis-aligned boxes only**. Plane clipping, arbitrary convex solids, CSG, patches, prefab models, per-face UV editing, complex entities, and multiplayer collaboration belong to later milestones.

### M1 toolbar and shortcuts

These are proposed defaults, displayed as tooltips and in a small Help panel. Shortcuts act only while the editor workspace owns focus; text inputs, the SHAG console, menus, and dialogs receive their own keys. The console keeps its existing backquote binding. `Escape` first cancels an active gesture, then closes an editor popover; Exit remains an explicit button/`editor close` command. Intercept browser save/undo shortcuts only while the workspace owns focus, and let `InputSystem` clear held game keys when focus changes.

| Toolbar action | Shortcut | M1 behavior |
| --- | --- | --- |
| New draft | None | Checkpoint the current draft, then create an untitled document with its own stable ID; remain on the current draft if storage fails. |
| Save Draft | `Ctrl/Cmd+S` | Write the versioned document and UI state to `localStorage`; show saved/failed status. |
| Export .map | `Ctrl/Cmd+Shift+S` | Validate and download current `.map`; show the filename and validation errors. |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` (`Ctrl+Y` also redoes) | Undo/redo committed document edits, including a whole drag as one step; disabled with no history. |
| Select / Brush tools | `V` / `B` | Switch the left-drag behavior in orthographic panes; active tool is visibly selected. |
| Delete / Duplicate selection | `Delete` / `Ctrl/Cmd+D` | Remove or duplicate the selected brush as one undoable edit; no action with no selection. |
| Grid size / Snap | Toolbar control; `[` / `]` for grid size | Choose power-of-two grid spacing and toggle snap; show the active value in each orthographic pane. |
| Frame selection / all | `F` / `Shift+F` | Center all views on the selected brush / all brushes; with no selection, `F` also frames all. Fit within the editor's zoom and camera-distance limits. |
| Fly the 3D camera | Middle/right drag or click, `W` `A` `S` `D` `Space` `C`, wheel | Flycam; see "M2 3D view: flycam navigation and view modes". |
| Reset Layout / Help | Buttons | Restore the default pane split and show the shortcut/gesture reference. |
| Compile / Compile Status / Playtest | Buttons only | Visible from M1 with the truthful unavailable states described above. |
| Exit Editor | Button or `editor close` | Flush draft state, dispose the editor session, and restore the previous composition. |

Group the top bar as File (New, Save Draft, Export), Edit (Undo, Redo, Delete, Duplicate), Tools (Select, Brush, grid/snap), View (Frame, Reset Layout), Build (Compile, Status, Playtest), then Help and Exit. The narrow status bar shows active pane, cursor Quake coordinates, work-plane coordinate, grid/snap, selected brush bounds, draft saved/dirty state, and compile state. The M1 inspector exposes editable min/max X/Y/Z, the active pane's work plane, one shader applied to all six faces, and the optional numeric test spawn. Later milestones can add per-face shader/UV fields without changing the basic brush gesture. Wireframe/textured preview controls appear when their rendering modes work in M2; do not ship inert toggles as though they are implemented.

**Toolbar checkpoint (2026-10-03):** the current shell groups Map, Edit,
Tools, View, and Build. Undo/Redo, placement tools, Compile/Status,
Playtest, and Exit remain visible; Map/Edit/View put less frequent actions in
keyboard-accessible disclosure menus. The compact buttons use editor-scoped
raised gold/violet styling inspired by the main menu. Menus close on action,
outside pointer press, or Escape. Help and Reset Layout still await their
underlying features.

The subsequent compact pass removes the redundant "GENERAL EDITOR" brand text
and the permanent draft-name field. The Map menu trigger displays the current
draft name (truncated visually if long); the menu contains its rename field,
New/Room Template/Local Drafts, Save/Export, and Server Maps/Save. Ctrl/Cmd+S
still saves directly. Renaming updates the trigger whenever a draft or server
map is opened or a new/template map is created.

### Three styling and UX concepts to explore

These are design proposals, not M1 acceptance gates. They keep the four-pane identity while making the editor feel less like a row of permanent forms. [Blender's maximized area](https://docs.blender.org/manual/en/5.2/interface/window_system/areas.html) and [Godot's distraction-free viewport](https://docs.godotengine.org/en/stable/getting_started/introduction/first_look_at_the_editor.html) show that temporary focus can coexist with a saved layout; [Substance 3D Modeler's contextual actions](https://helpx.adobe.com/substance-3d-modeler/desktop/interface/actions-menu.html) are a precedent for tools appearing near the work. The SHAGGED designs below are our proposed adaptations.

| Idea | Mapper experience and visual treatment | Plan adjustment | Cost / test |
| --- | --- | --- | --- |
| **Focus pane with live companions** | Double-click a pane label to make that view dominant while the other three become narrow, live labeled strips; click a strip to promote it. A second double-click restores the exact 2×2 split. The active pane has a stronger border and axis label, not a separate document or camera. | `FourViewLayout` stores normal split and focused pane separately in UI state; all four views continue to reflect edits. Add after basic four-pane resize works, as M1 polish or M2. | Test readability at small widths, pointer routing, keyboard focus, and restoration after refresh. Fall back to a simple maximize/restore if live strips cost too much rendering. |
| **Precision bubble at the cursor** | During brush creation/move/resize, a quiet floating badge shows X/Y/Z dimensions, snap size, and the hidden work-plane value beside the ghost shape. Clicking a number, or pressing `Tab` during a gesture, lets the mapper type an exact value; Enter commits and Escape cancels. The inspector remains available for deliberate editing. | `ViewportInput` publishes a transient gesture model; `EditorShell` renders the bubble without writing to the document until commit. Prototype visual readout in M1; add inline numeric entry only after pointer cancellation/history is reliable. | Keep badge out of the pointer target and away from pane edges. Test typed values, focus transfer, and one undo step when mouse and keyboard are mixed. |
| **Build runway** | The right side of the top bar shows a compact, labeled state path: Local Draft → Server Saved → Compiled → Playable. Each step shows revision/status and opens its detail or error log. Compile and Playtest stay visible but make their prerequisites understandable at a glance. | M1 shows Local Draft plus explicit `Compiler not connected`/`Playtest unavailable`; M3 binds the later steps to server job and exact-build readiness. This replaces a generic spinner or ambiguous green success toast. | Keep source and build revisions distinct, expose text as well as color, and never imply that Export .map is a server Save. Test stale build, failed job, and offline states. |

Use a calm, low-glare workspace surface so grids, brush edges, and shader previews dominate. Scope editor CSS under `.shagged-root` and derive its base surfaces/text from the existing `UITheme` tokens; use a compact numeric font for coordinates and dimensions. Give X/Y/Z consistent accent colors **and letter labels**, use one separate selection accent, and reserve warning/error colors for actual problems. Do not rely on color alone to distinguish axes, build states, or selected faces. Keep pane headers and the precision bubble visually light; avoid heavy translucent panels over the geometry. Icons need labels or tooltips, especially for Save Draft, Export .map, Compile, and Playtest, whose meanings differ.

### Pointer gestures and brush drawing

| Context | Pointer gesture | Result |
| --- | --- | --- |
| Orthographic pane, Brush tool | Left drag | Create a box from the two visible snapped corners; the third axis uses that pane's work plane and thickness. |
| Orthographic pane, Select tool | Left click / left drag on brush body | Select a brush / translate the selection in the two visible axes. Click empty space to clear selection. |
| Selected brush edge/handle in an orthographic pane | Left drag | Resize the corresponding visible-axis bound; the other axes stay fixed. Numeric min/max fields handle exact hidden-axis edits. |
| Any orthographic pane | Middle drag / wheel | Pan the linked view center / zoom the linked projections, keeping the active pane's world point under the cursor stable when zooming. |
| Perspective pane | Left click / right drag / wheel | Select a visible brush / orbit the editor camera / dolly. Brush creation stays in orthographic panes for M1. |
| Any active drag | `Escape` or pointer cancel | Drop the preview and return to the pre-drag document without a history entry. |

Brush gesture contract: on pointer-down, record the pane, work plane, snapped start point, document revision, and current tool, then capture the pointer. While dragging, project onto the same pane plane even if the cursor leaves its rectangle, snap both endpoints, normalize min/max regardless of drag direction, and show a translucent preview plus dimensions in all four views. This preview is not yet a document object. A click or drag that collapses to zero grid cells creates nothing; show a minimum-size hint. On pointer-up, validate all three extents, assign a stable ID, commit exactly one document transaction, select the new brush, and autosave after the debounce. If the tool changes, focus moves to the console, or pointer capture is lost mid-gesture, cancel safely. A move/resize drag uses the same preview/commit pattern and never allows an inverted or zero-thickness brush.

### Document and export contract

Start with a typed document of `{ worldspawn, objects, testSpawn? }` in Quake units, where M1 objects are box brushes and the type can later grow to point entities, brush entities, patches, and editor-only groups. The optional M1 test spawn stores numeric origin/angle and serializes to one `info_player_deathmatch` entity; M2 replaces that narrow field with general entity placement and a migration. A box stores snapped minimum/maximum XYZ, stable ID, and per-face shader plus texture transform metadata. Keep `worldspawn` separate from point entities. Validate finite coordinates, `min < max` on all axes, grid limits, safe shader names, and serialization of quotes/newlines in entity values before export. Only committed content edits increment the document revision; selection, camera, pane sizes, and tool choice are UI state and do not change exported bytes. Sort exported objects by stable ID, not selection or mesh insertion order.

Export one canonical dialect: **Quake 3 `brushDef`** using six outward-facing plane triples, a brush primitive 2×3 UV matrix, shader name, and trailing content/surface/value fields. This matches the local generator's shape, but face order, plane orientation, default UV scale, and texture naming must be confirmed with the target MakeBSP parser. For Washoi, the local shader-list guidance says `.map` faces use unprefixed names such as `blx/blx_dark`, while asset resolution supplies `textures/`. Avoid deriving export planes from Babylon vertex buffers, since axis conversion changes handedness. Use deterministic ordering and number formatting so save/reopen diffs are stable. Browser delivery can be a `.map` download; native save integration is a later convenience.

An illustrative file shape (plane values omitted intentionally until the MakeBSP spike fixes canonical winding):

```text
{
"classname" "worldspawn"
{
brushDef
{
<six plane triples, UV matrices, shaders and flags>
}
}
}
```

Import is not required for the first export-only slice, but losing work on refresh is unacceptable for an editor. Store the versioned JSON draft and editor UI state in `localStorage`, and offer a `.map` download; later add a lossless `.map` importer. The existing `MapParser` can inspect exported geometry, but cannot be the editing or round-trip source of truth because its `brushDef` preprocessing drops UV and flag data.

For M1, **Save** explicitly checkpoints the local draft and reports storage failure; **Export .map** downloads a fresh serialization of the current document. Neither implies a server save. On reopen, restore a validated draft and UI record, then regenerate all meshes; never persist Babylon objects. A new untitled map gets a stable draft ID before its first edit, and a named map keeps that ID across renames so draft lookup does not silently lose work.

## Implementation file plan

These are **proposed files, not files that exist today**. This layout is enough to start M1 without committing to the later compiler transport. Create files as their first vertical slice needs them; avoid empty barrels and placeholder classes. Keep the pure document and exporter free of Babylon, DOM, and Node imports so the same geometry rules can be checked headlessly.

### M1 browser and pure editor core

| Proposed file | Purpose | First slice |
| --- | --- | --- |
| `src/engine/console/commands/EditorCommand.ts` | Auto-discovered developer command for `editor open\|close\|status`; ask the registered launcher and return a clear failure in headless mode. | 1 |
| `src/engine/editor/EditorLauncher.ts` | Small registration/interface module (`open`, `close`, `status`) with no DOM or Babylon imports, following `GameplayMapLauncher.ts`. | 1 |
| `src/engine/editor/BrowserEditorHost.ts` | Browser implementation of the launcher; owns the game/editor mode, active session, input handoff, and idempotent open/close. It receives existing game update/render callbacks rather than importing FPS classes. | 1 |
| `src/engine/editor/EditorSession.ts` | Own one editor opening: document, view, UI, subscriptions, frame update, and disposal. Reopen builds a new session from a draft. | 1 |
| `src/engine/editor/view/EditorScene.ts` | Create/dispose the Babylon editor scene, four cameras, grids, and brush preview meshes; no gameplay renderer or BSP load. | 1–2 |
| `src/engine/editor/view/FourViewLayout.ts` | Pane rectangles, camera viewports, resize/high-DPI measurements, and named XY/XZ/YZ/perspective views. | 1 |
| `src/engine/editor/view/Coordinates.ts` | One Quake Z-up ↔ Babylon projection/conversion boundary shared by the four cameras, previews, and picking; never imported by map export. | 1–2 |
| `src/engine/editor/document/EditorTypes.ts` | Versioned Quake-space document types: stable IDs, box bounds, six face shaders, worldspawn, and optional numeric test spawn. Extend the schema with general entities, patches, and groups when those tools arrive. | 2 |
| `src/engine/editor/document/EditorDocument.ts` | Apply validated create/select/move/resize edits and publish one document-change signal consumed by all four views. Babylon meshes are derived, never authoritative. | 2–3 |
| `src/engine/editor/view/ViewportInput.ts` | Route pointer coordinates to a pane, project drags onto that view's Quake plane, apply grid snap, and manage selection/drag gestures. | 3 |
| `src/engine/editor/document/EditorHistory.ts` | Undo/redo of document transactions; a drag is one transaction rather than one entry per pointer move. | 3 |
| `src/engine/editor/map/BoxBrushPlanes.ts` | Pure six-face plane/winding generation and rejection of invalid or zero-thickness boxes. | 4 |
| `src/engine/editor/map/MapWriter.ts` | Deterministic `worldspawn`/`brushDef` `.map` serialization from the document, with stable ordering and exact face shader names. | 4 |
| `src/engine/editor/document/DraftStore.ts` | Versioned `localStorage` recovery record plus UI state; injected storage adapter for tests, schema validation, migration hook, debounce, and explicit flush before Exit/Playtest. | 4 |
| `src/engine/editor/ui/EditorShell.ts` | DOM pane labels/splitters, tool and inspector areas, console focus coordination, and Exit; owns and removes its listeners. | 1–5 |
| `src/engine/editor/ui/EditorToolbar.ts` | Save/Export, Compile, Compile Status, Playtest controls; M1 shows honest unavailable build/playtest states. | 4–5 |
| `src/main.ts` (edit) | Register `BrowserEditorHost` after engine/canvas setup and dispatch the existing render loop to game or editor. Keep the base FPS shell idle while editing. | 1 |
| `src/engine/console/__tests__/EditorCommand.test.ts` | Check launch/status/close and unavailable-host failure through the real registry. | 1 |
| `src/engine/editor/map/__tests__/MapWriter.test.ts` | Check deterministic bytes, six valid faces, shader names, and invalid-brush rejection against fixed geometry fixtures. | 4 |

`EditorScene.ts` and `FourViewLayout.ts` are separate because visual scene lifetime and pane geometry change for different reasons. If the four-camera experiment fails, pane rendering can change without rewriting the document, exporter, command, or host. A thin `src/engine/editor/index.ts` is optional only when imports actually benefit from it.

### M3 server and Playtest additions

| Proposed file | Purpose |
| --- | --- |
| `src/engine/editor/client/ShaggedApi.ts` | Browser HTTP client using an injected API base URL for health, Server Save/Open, compile request, status polling, revision conflicts, and offline errors. Contains no Node process code. |
| `src/engine/editor/server/MapStore.ts` | Node-only map-name validation, revisioned `.map` plus optional sidecar save, revision lookup, and immutable compile snapshots. A revision becomes visible only when both files succeed. |
| `src/engine/editor/server/CompilerConfig.ts` | One Node-only resolver for flags/env/defaults, binary/media/maps-root checks, and health reasons shared by server and CLI. |
| `src/engine/editor/server/BuildRecipe.ts` | Pure Washoi quality-tier to MakeBSP/MakeLight argument-array mapping; no browser-provided raw flags. |
| `src/engine/editor/server/CompileJobs.ts` | Shared job manager for API and CLI: queued/running/failed/compiled/playable states, logs, cancellation policy, and child-process ownership. |
| `src/engine/editor/server/BuildReadiness.ts` | Verify that the exact compiled build is resolvable by both game client and lobby-spawned server; return its runtime map name/build ID. Delivery details remain an M3 spike. |
| `src/cli/shagged-server.ts` | Start the loopback editor API, using `MapStore` and `CompileJobs`; independent of `lobby:server`. |
| `src/cli/shagged-compile.ts` | Headless CLI over the same save/compile service, using an already saved map name. |
| `package.json` (edit) | Add `shagged:server` and `shagged:compile` scripts only when their entry points work. |
| `.env.example` (edit) | Document `VITE_SHAGGED_API_URL` for the browser and Node-only `SHAGGED_*` compiler/storage options. |
| `src/engine/editor/PlaytestHandoff.ts` | Check playable revision, checkpoint draft/UI, close the editor session, launch the returned runtime map name, and handle failed launch/Return to Editor. |
| Existing game/escape UI (edit after locating owner) | Add Return to Editor when the active match was started by SHAGGED; do not make a global return route for ordinary matches. |

The `server/` modules must stay out of browser imports and browser barrels. Shared data contracts can be placed in a browser-safe `src/engine/editor/protocol/` module when the API is implemented; never make the browser import the Node job manager for its status types.

### Later authoring extensions

| Proposed file | Purpose | Milestone |
| --- | --- | --- |
| `src/engine/editor/document/EntityCatalog.ts` | Read a vetted subset of Washoi entity definitions for point/brush entity placement and key editing; keep unknown keys in the document. | M2 |
| `src/engine/editor/document/Groups.ts` | Authoring-only group membership and grouped transforms; flatten on export until `func_group` behavior is proved. | M2 |
| `src/engine/editor/view/TexturePreview.ts` | Editor material/texture and wireframe display modes, independent of compiled lightmaps. | M2 |
| `src/engine/editor/document/PatchGeometry.ts` | Pure `patchDef2` grid validation, control transforms, and deterministic bevel/arch/cylinder/cone/cap/tube recipe expansion; the document and writer gain patch records separately. | M4 |
| `src/engine/editor/prefab/PrefabCatalog.ts` | Versioned brush-kit definitions, dimensions, sockets, allowed variants, and thumbnails for Block Builder. | M2+ |
| `src/engine/editor/prefab/PrefabPlacement.ts` | Pure integer Quake-space socket/grid matching, quarter-turn transforms, overlap checks, and placement validity. | M2+ |
| `src/engine/editor/prefab/PrefabExpander.ts` | Deterministically flatten placed module instances to ordinary brushes/entities before `MapWriter`; preserve stable child IDs. | M2+ |
| `src/engine/editor/view/PrefabPreview.ts` | Babylon ghost, socket highlights, instance rendering, and optional gizmos driven by pure placement results. | M2+ |
| `src/engine/editor/view/AnnotationOverlay.ts` | Project read-only Quake-space health issues, measurements, entity links, build ghosts, and playtest pins into each pane without changing document objects. | M2+ |
| `src/engine/editor/protocol/EditorSidecar.ts` | Versioned browser/Node contract for an editable snapshot and editor-only metadata matched to one canonical `.map` revision. | M3+ |

Build M1 in vertical slices: (0) identify the target MakeBSP binary/profile, compile a known-good room, and prove basic four-pane camera/picking behavior before freezing exporter/view details; (1) `editor open`/`close` and a blank four-pane scene with a single render-loop owner; (2) one document box rendered in all panes; (3) drag creation, numeric resize, selection, and undo; (4) deterministic export, `localStorage` recovery, and an offline MakeBSP check of an editor-exported closed room; (5) Compile/Status/Playtest controls with truthful unavailable states. Slice 0 can run beside host work, but do not leave it until after the writer is built. Do not pre-create the M3 server or later authoring files during M1. The M3 sequence is server Save/Open, shared compile job and CLI, exact-build readiness, then Playtest/Return.

## M1 code contracts and first integration sequence

The source check narrows the first edit points: `src/engine/console/commands/index.ts` uses an eager `import.meta.glob("./*Command.ts")`; `src/main.ts` creates the active engine/canvas/scene, registers the FPS launcher, then runs one loop that always updates `FPSPlayer` and renders the captured scene. `FPSController.setEnabled(false)` clears movement and releases pointer lock, but the original Babylon camera was also attached to the canvas. `DebugConsole` handles backquote/Escape on document capture, while `CommandBindings` listens on window. These are real integration boundaries, not work for `MapWriter` or the editor document.

### Browser host contract

The following shapes are illustrative TypeScript contracts to settle ownership before implementation:

```ts
type EditorMode = "closed" | "opening" | "open" | "closing";
type EditorStatus = { mode: EditorMode; draftId?: string; dirty: boolean };

interface EditorLauncher {
  open(draftId?: string): Promise<EditorStatus>;
  close(): Promise<EditorStatus>;
  status(): EditorStatus;
}

interface EditorSession {
  update(deltaSeconds: number): void;
  render(): void;
  dispose(): void;
}
```

`EditorCommand.ts` imports only the launcher registration and command types; the eager command loader must not import the editor UI, `window`, or Babylon scene construction. The browser registers one launcher after the final `renderer.canvas`, game scene, player, controller, and lobby are ready. `main.ts` keeps one `engine.runRenderLoop`: in `open`, only `session.update/render` runs; otherwise the existing `player.update/scene.render` runs. Do not install a second loop or call `stopRenderLoop` from the editor. After a successful `editor open` from the console, close the console and focus the workspace root; backquote can reopen it at any time.

In `main.ts`, inject callbacks rather than importing FPS objects into `BrowserEditorHost`: `canOpen` reads the registered FPS connection state; `suspendGame` captures controller enabled state, camera attachment, and lobby visibility and returns a restoration closure; `updateAndRenderGame(dt)` runs the two existing loop calls. The loop then calls one `host.frame(dt)` dispatch method. This keeps the render-loop change small and makes host transitions testable with fake callbacks. Use the final `renderer.canvas` for all editor pointer and camera wiring, because renderer initialization can replace the original canvas.

Treat open/close as serialized transitions. `open` during `opening` returns the same pending result; `open` while `open` focuses the existing session; `close` during `opening` waits and then closes; a second `close` is harmless. First reject a connected match via an injected `canOpen` callback (the FPS layer already exposes a connection check), then save prior lobby visibility and FPS-controller enabled state, release pointer lock and camera control, and create the editor session. On close or failed open, dispose partial editor resources and restore exactly the captured UI/input state. `editor status` reports mode, active draft ID, and dirty state; the command maps a rejected transition to `fail(...)` so headless batches exit nonzero.

### Document, transactions, and derived views

```ts
type FaceKey = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
type Vec3q = { x: number; y: number; z: number }; // Quake units, Z up

interface BoxBrush {
  id: string;
  min: Vec3q;
  max: Vec3q;
  faces: Record<FaceKey, {
    shader: string;
    uv: [number, number, number, number, number, number];
    flags: [number, number, number]; // M1 defaults to 0/0/0
  }>;
}

interface EditorDocumentData {
  schemaVersion: 1;
  draftId: string;
  revision: number;
  worldspawn: Record<string, string>;
  brushes: BoxBrush[];
  testSpawn?: { origin: Vec3q; angle: number };
}
```

Keep selection, active tool, cameras, work planes, pane sizes, and build status in a separate `EditorUiState`; they do not affect `.map` bytes. `EditorDocument` exposes validated operations, never writable brush arrays. For M1's small maps, `EditorHistory` can hold bounded before/after document snapshots per committed operation; optimize to deltas only if memory measurements justify it. Creation/move/resize previews live in gesture state, not in document history. A successful pointer-up or numeric edit commits once; undo/redo each produces a new local revision while restoring prior content. The saved-server revision introduced in M3 is a separate value. The view observes committed document changes and optional gesture previews, then replaces/repositions meshes by stable brush ID.

One Quake-to-Babylon conversion module serves all four cameras, previews, picking, and editor annotations; the exporter never calls it. `FourViewLayout` owns CSS pane bounds and camera viewport rectangles. `ViewportInput` first checks the editor shell's hit regions, then maps the pointer into the chosen pane and Quake work plane. A focusable workspace root receives editor shortcuts and stops propagation for consumed keys before global game bindings; it yields to the console, text fields, and dialogs. The existing debug console keeps backquote/Escape precedence. Verify this event routing in a browser before adding all shortcuts.

### Contracts that keep later tools possible

M1 needs only boxes, but its internal boundaries should admit entities, patches,
prefabs, diagnostics, and playtest data without replacing the document or
writer. These are extension contracts, **not** a request to implement every
future subsystem in M1.

```mermaid
flowchart LR
    Gesture[Tool gesture or inspector] --> Proposal[Validated edit proposal]
    Proposal --> History[One document transaction]
    History --> Snapshot[Immutable content snapshot]
    Snapshot --> Preview[Four derived views]
    Snapshot --> Validate[Pure validators]
    Snapshot --> Expand[Prefab and recipe expansion]
    Expand --> Write[Canonical .map writer]
    Write --> Source[.map bytes and source locations]
    Source --> Build[Revision-bound MakeBSP job]
    Build --> Result[Immutable build record]
    Result --> Overlays[Diagnostics, ghost, notes]
    Snapshot --> Overlays
    Overlays --> Preview
```

| Contract to settle | M1 implementation | Later feature enabled | Failure if skipped |
| --- | --- | --- | --- |
| Stable authoring identity | Assign a never-reused ID at creation; boxes use six axis face keys. Keep IDs independent of array position and Babylon mesh identity. | Groups, face paint, source diff, diagnostics, notes. Arbitrary convex faces gain their own persistent IDs when introduced. | Selection and annotations drift after reorder, undo, or reload. |
| Explicit ownership and references | `worldspawn` owns M1 boxes. Leave room in the next schema for brush-entity ownership and authoring-only group membership by ID; reject missing references and group cycles. | Doors/triggers, groups, entity links, reusable rooms. | A group transform or export silently changes which entity owns a brush. |
| One validated edit path | Tools propose changes; `EditorDocument` validates and commits one transaction, emits changed IDs, and advances a local content revision. Preview drags remain transient. M1 history may store bounded snapshots. | Gizmos, numeric inspector, prefab placement, patch handles, multi-select. | Different tools bypass undo/validation or emit a history step per pointer move. |
| Pure geometry and export | Keep Quake-space geometry operations, prefab expansion, validators, and `MapWriter` independent of Babylon/DOM/Node. The writer consumes an immutable expanded snapshot and emits bytes plus optional object/face-to-line ranges. | Alternate view modes, headless compile checks, clickable compiler errors, region builds. | Render mesh topology or pane state changes exported source. |
| Derived view registry | Each pane projects the same snapshot and transient gesture. Read-only annotations carry a document ID, target ID or Quake-space position, and optional build ID. A pane may render or pick an annotation without changing the map. | Health tray, measurements, links, ghosts, heatmaps, playtest pins. | Analysis data contaminates `.map` or becomes stale without a visible warning. |
| Versioned source and metadata | M1 draft schema has migrations; `.map` remains the standalone compiler source. M3 sidecar stores IDs, groups, recipes, and bookmarks next to the exact source revision. | Reopen editable server maps, prefab updates, build comparisons. | Reimport regenerates IDs; old notes and prefab parameters lose their targets. |
| Exact build identity | M3 records source revision, a hash of the exported bytes, compiler profile/version, quality, and output artifact under one build ID. Job status and Playtest refer to that ID. | Diagnostics, draft-versus-build ghost, reproducible comparisons, telemetry. | A successful compile of an older same-name map appears current. |

M1 can retain `brushes: BoxBrush[]` in schema version 1. Before general entities
or prefabs ship, migrate to an authoring-object union keyed by stable ID. A
brush entity owns brush IDs; a group references object IDs without taking map
ownership. The exporter first resolves owner relationships, expands recipes,
validates the resulting compiler objects, then writes them in deterministic
order. Unknown entity keys survive unchanged. A prefab instance remains one
editable source object; generated child IDs derive from the instance and part
IDs and are **never** independently edited. Detach to Brushes is an explicit,
undoable conversion. Pin a definition version and retain its data or an
immutable library reference so removing a kit cannot reshape an old draft.

Tool authors should implement a small gesture lifecycle: `begin` captures the
base revision and targets, `preview` produces temporary geometry, `commit`
submits one edit proposal, and `cancel` discards it. If the base revision or a
target changed meanwhile, reject/rebase explicitly; do not apply stale pointer
coordinates to new objects. Inspector edits and keyboard commands use the same
proposal path. This gives future shape handles and Babylon gizmos identical
undo, validation, and dirty-state behavior without making a gizmo authoritative.

| Future slice | New data and pure operation | UI adapter | Proof before calling it complete |
| --- | --- | --- | --- |
| M2 entities and groups | Point/brush entity records, owner references, arbitrary key/value fields, group ID sets, link validation. | Markers, inspector, link overlay, multi-select transform. | Compile a map with one point entity and one brush entity; group/ungroup does not alter exported ownership or bytes. |
| M2 materials and health | Stable face keys, shader catalog lookup, pure validation issues with target IDs and severity. | Face picker, textured/edge modes, clickable Health tray. | Paint one face, undo/reload/export; missing shader remains visible and blocks only where export truly fails. |
| M2+ Block Builder | Versioned prefab definitions and instances; pure socket solver and deterministic expansion. | Palette, placement ghost, optional Babylon gizmo. | Mixed-size sockets, rotation, overlap, undo, reopen, and a sealed compiled room. |
| M3 compile and review | Immutable save/build records, source-line provenance, document/build diff, build-bound annotations. | Status, clickable logs, ghost overlay, Playtest/Return notes. | Old logs and pins visibly retain their old build ID; Playtest never launches stale output. |
| M4 patches and shape recipes | Control-grid IDs, `patchDef2` writer, deterministic arch/bevel/cylinder/cone/cap/tube recipe expansion. | Curves menu, control handles, and parameter inspector. | Round-trip editable recipe; compiler acceptance for open/capped forms; in-game collision walk/sweep. |
| Later CSG and telemetry | Persistent plane/face IDs and robust convex validation; separately, aggregated build-bound event samples. | Vertex/edge tools or heatmap overlays. | Degenerate brushes cannot export; old telemetry cannot masquerade as current source. |

The main technical risk beyond M1 is **topology change**. Box faces have stable
axis keys, but clipping, subtraction, and arbitrary convex editing create and
destroy faces. Do not promise persistent face painting or face-level diagnostic
links for those tools until a face-ID transfer rule and invalid-brush repair
strategy are tested. This is a later geometry project, not a hidden M1 task.

### Export, persistence, and failure behavior

`BoxBrushPlanes` receives Quake-space bounds and returns the six face triples in a fixed order. `MapWriter` receives a validated snapshot and returns deterministic UTF-8 text with LF newlines, fixed numeric formatting, fixed face/object order, and no timestamps or Babylon data. Start with the MakeBSP-proven UV/shader convention from slice 0. It may also return face-to-line provenance for future clickable diagnostics; this metadata is not written into `.map`. The M1 download uses only the text result. A failed validation leaves the editor open with the offending brush selected and does not download a partial file.

`DraftStore` takes an injected storage adapter for headless tests and the browser's `localStorage` in production. It saves a versioned document/UI pair under a stable draft ID, reports quota/schema errors, and never silently overwrites the in-memory session after a bad load. Debounced autosave runs after commits; Save and Exit call a synchronous flush. If Exit cannot persist the current draft, keep the editor open and offer Export .map or retry. The same rule later applies before Playtest. M1 does not need the M3 HTTP client or server sidecar.

| Slice | Main files/area | Reviewable outcome | Proof before moving on |
| --- | --- | --- | --- |
| 0: compiler + viewport probes | Washoi build recipe and test room; disposable Babylon view probe | Known-good NetRadiant room, exact MakeBSP command/version, shader name, and output recorded; four-pane viewport/picking feasibility measured. | Reference room compiles; four panes clear, resize, and pick correctly. If either fails, revise exporter/view design before broad implementation. |
| 1: host/console | `EditorCommand`, `EditorLauncher`, `BrowserEditorHost`, `EditorSession`, `EditorShell`, `main.ts` | `developer 1; editor open` shows a disposable blank workspace; close restores lobby/game shell. | Headless command fails clearly without a visual host; repeated open/close leaves one loop and no extra listeners. |
| 2: four views/document | `EditorTypes`, `Coordinates`, `FourViewLayout`, `EditorScene` | One asymmetric box appears in all panes from one Quake-space snapshot. | Axis signs, resize, high-DPI pane coordinates, and camera picking are checked in a browser. |
| 3: gestures/history | `EditorDocument`, `EditorHistory`, `ViewportInput`, inspector | Draw, select, move, resize, cancel, undo/redo, and numeric edits work. | Inverse drags normalize bounds; canceled gestures create no history; each completed gesture creates one step. |
| 4: persistence/export | `BoxBrushPlanes`, `MapWriter`, `DraftStore`, serializer fixtures | Save Draft, refresh recovery, deterministic `.map` download, and closed-room fixture. | Raw parser accepts source and target MakeBSP compiles the editor-exported room. |
| 5: toolbar/hardening | `EditorToolbar`, Help/status UI, lifecycle cleanup | Compile/Status/Playtest buttons show accurate unavailable states and Help lists real shortcuts. | No button implies a successful compile or launches an older same-name map; full M1 acceptance list below passes. |

### Readiness assessment before coding

**Ready to begin M1 slices 0–1; not ready to declare the full milestone solved.** The console registration, browser entry point, input handoff, document boundary, and slice acceptance tests are concrete enough to implement. No extra product architecture decision is needed to start. Treat M1 as a desktop browser editor initially: SHAG's `DebugConsole` is disabled on mobile, so its promised console launch is not available there today.

| Question | Present state | Decision or proof needed |
| --- | --- | --- |
| How does `editor open` reach a browser host? | Verified eager command discovery and a launcher-registration precedent. | Implement the small registered interface and headless failure test. |
| Can four panes share one Babylon scene and canvas cleanly? | Plausible, not demonstrated here. | In slice 1–2, test four camera viewports, clearing, grids, pointer picking, splitter resize, and high-DPI coordinates; switch to separate pane render surfaces only if evidence demands it. |
| Does editor input fully release FPS input? | `setEnabled(false)` and pointer-lock release exist; the FPS camera is separately attached to the canvas. | Capture/restore controller and camera-control state and test console, Escape, focus changes, open/close/reopen. Reject a connected match before entering. |
| Can a SHAGGED export be called MakeBSP-valid? | Not yet. Repository-wide filename search found no MakeBSP/MakeLight executable; no binary was run. | Locate the intended binary/profile/media root and prove a NetRadiant reference room in slice 0, then an editor-exported room in slice 4. |
| Which face shader is safe as the default? | Washoi's unprefixed naming rule is known; an installed/resolving shader has not been proved. | Pick one from the mounted assets and confirm it in the offline compile log/preview. |

When code work starts, run headless checks first: targeted command/document/writer tests, `npm run typecheck`, then the repository's required gates. Because slice 1 changes `src/main.ts` render dispatch, run the renderer-sensitive regressions from `AGENTS.md` (`test:simulation`, `test:physics`, `server:tick`, `server:fuzz -- --ticks 1000`, and the `cli:game` BSP inspection command) and report results before browser smoke testing. Browser verification is still necessary for pane layout, pointer capture, focus, and disposal; headless tests cannot establish those visual behaviors.

| M1 validation pass | Command or scenario | What it proves |
| --- | --- | --- |
| Pure/command tests | `npm run test:run` (with focused tests during slices) | Command failure semantics, document operations/history, coordinate conversions, serializer determinism, draft migration. |
| Project gates | `npm run typecheck`, `npm run build`, `npm run gate:biome` | Type/import correctness, browser bundle, formatting/lint baseline. |
| Headless map baseline | `npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"` | Existing indexed BSP inspection still works after host wiring. |
| Render-loop regressions | `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`, `npm run server:fuzz -- --ticks 1000` | Existing game/physics/server behavior remains intact when `main.ts` dispatch changes. |
| Offline exporter proof | Exact MakeBSP command from P0, run on the editor-exported closed room | The target compiler accepts the generated source; record binary version/log/BSP result. |
| Browser interaction | Open/close/reopen; four-pane resize/pick; inverse drag/cancel; Save/reload; console focus; game input restoration | Visual/input lifecycle and one active composition. Run after headless checks. |

For implementation review, record the precise commands and output, the chosen shader, binary/version, map fixture, browser/backend, and any failed or skipped gate. A visually convincing editor without the offline compiler proof is an export preview, not a completed M1.

## Validation and acceptance gate

For M1, validate the pure box-to-`brushDef` serializer against fixed geometry fixtures and parse the exported `.map` with SHAG's raw-map parser. Also run one **offline** closed-room export through the target MakeBSP binary with the Washoi profile and media path. Record the binary version, exact command, log, output path, BSP header, and whether the chosen shader resolves. This is a developer acceptance check, not the editor Compile button; MakeLight and game launch can wait. No MakeBSP executable was found under `editor/` in this research pass, so locating/installing the intended binary is an M1 prerequisite before claiming the export is compiler-valid. The first **server-side compile integration milestone (M3)** repeats the check through its job service, then loads the result through the normal indexed/headless and gameplay paths to inspect bounds, material, collision, and player start. The existing [`headless-mode.md`](../manual/guides/headless-mode.md) gives the inspection command pattern.

Minimum acceptance cases:

- A new user can draw a brush in XY, adjust Z in XZ/YZ, see matching geometry in all four views, undo/redo, and download a `.map`. Draw from all four drag directions; cancel mid-drag; resize from both visible-axis handles; verify one history step per gesture.
- `developer 1; editor open` launches from the normal browser console; `editor status` works in-session; `editor close` or Exit restores the previous screen without duplicate render loops or input listeners. Reopening works in the same session.
- Export the same document twice and get identical bytes; reopening its `localStorage` draft restores brush bounds, shader names, selection, camera positions, grid, and pane layout.
- Compile, Compile Status, and Playtest controls appear with truthful `Not configured`/unavailable states until the server-side job path exists.
- Invalid zero-thickness or nonfinite brushes are blocked with a useful error instead of silently generating malformed planes.
- A closed-room export passes an offline MakeBSP run using the target Washoi setup. Until that run is available, label M1 export compatibility unverified rather than calling the file MakeBSP-valid.

The M3 gate adds: a closed-room fixture compiles on the server, emits a SHAG-readable FBSP, loads through the normal game path, and returns to the same saved editor session. Do not assume `MapParser.parse()` or a nice Babylon preview proves MakeBSP compatibility.

## Difficulty and risks

**Viability: good for box-based mapping; moderate engineering effort.** A credible M1, including console launch, four views, basic brush manipulation/export, `localStorage` recovery, and truthful toolbar controls, is roughly 4–7 focused developer weeks for one experienced TypeScript/Babylon developer. This is an estimate, not a measured schedule. Server-side compilation, map delivery, and playtest return are M3 and need a separate estimate after a CLI/job-protocol spike. The four-pane layout itself is modest; precise grid interaction, mode handoff, coherent selection/undo, texture coordinates, and valid export dominate M1. A broader NetRadiant replacement (arbitrary convex editing, clipping/CSG, patches, texture tools, entity catalog) is a separate, much larger project.

| Risk | Early proof or containment |
| --- | --- |
| `brushDef` dialect, winding, and UV conventions differ between local generator, NetRadiant, and MakeBSP. | Generate a tiny map in NetRadiant, compare with `MapGenerator`, compile both, inspect face normals/textures, and freeze a golden fixture. |
| Quake Z-up and Babylon Y-up lead to mirrored picking or export. | Keep Quake coordinates in the document; unit-test round-trip projection and plane normals for all six box faces. |
| Four cameras share one canvas but pointer/picking, grids, and scene overlays behave differently per pane. | Prototype pane hit testing and drag preview before document UI polish; test resize and high-DPI scaling. |
| Exported map compiles but has leaks, missing shaders, or no usable spawn. | Use a closed-room fixture, known-good shader from mounted PK3s, explicit spawn, and MakeBSP log checks. |
| Raw-map parser loses UV/flags. | Keep a new lossless editor model and serializer; treat current parser only as a partial geometry check. |
| A browser cannot directly invoke MakeBSP. | The later server-side CLI owns compile jobs; M1 shows the controls but labels the unavailable job/playtest states accurately. |
| Console entry from an active match could leave networking live while local rendering/input is paused. | First milestone refuses `editor open` during a connection; later define disconnect or background-session behavior explicitly. |
| Existing scene and input systems have competing lifecycle ownership. | Route through one browser mode controller; verify open/close/reopen, Escape/console focus, and listener counts in a browser smoke test. |

## Open questions for the first technical spike

1. For the M1 offline fixture and M3 server, where is the intended MakeBSP binary/version used with `editor/makebspdata/washoi.json`, and exactly where does it write its BSP? The Washoi build menu supplies the `-game washoi -fs_basepath <media-root>` command shape and tier flags, but no compile was run here.
2. Which installed unprefixed shader name should be the first default face material? Confirm it in the mounted PK3 index and MakeBSP output, not only a source example.
3. Does the intended first target need FBSP/Washoi exclusively, or should the editor expose a Q3/IBSP profile later? This plan assumes FBSP/Washoi first.
4. What maps directory and port should `shagged:server` use, and how should the compiled artifact become visible to both the normal game client and lobby-spawned server in M3? The proposed API and scripts are design only; no backend exists yet.

## References

- SHAG source and guides linked in the verified-starting-point table.
- [NetRadiant Custom repository and feature list](https://github.com/Garux/netradiant-custom/)
- [NetRadiant orthographic view and brush drag implementation](https://github.com/Garux/netradiant-custom/blob/master/radiant/xywindow.cpp)
- [NetRadiant window layout source](https://github.com/Garux/netradiant-custom/blob/master/radiant/mainframe.cpp)
- [NetRadiant license](https://github.com/Garux/netradiant-custom/blob/master/LICENSE)
- SHAG's Washoi compiler recipe: `editor/gamepacks/washoi.game/default_build_menu.xml` and `editor/makebspdata/washoi.json`.
