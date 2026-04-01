# Demo UI Improvement

## Status

This document is a source-verified implementation plan for improving the Demo Archive UI in `LobbyPanel`.

Goal for this ticket:
- make demo cards readable and visually aligned with matchmaking cards
- support levelshot banners via a predictable path convention
- fix obvious UX failures (silent errors, cramped layout, style scattering)

Out of scope for this ticket:
- deep demo playback engine wiring/refactor (tracked as a dependency risk below)

## Verified Findings (Code Review)

### 1) Demos tab is width-constrained to 720px

`GamePanel.css` defaults `.game-panel__scroll` to `max-width: 720px`.
`LobbyPanel.css` removes that max-width for `.lobby__layout`, `.lobby__leaderboard`, `.lobby__profile`, but **not** for `.lobby__demos`.

Impact:
- demo grid is rendered inside ~688px content width after padding
- with `repeat(4, 1fr)` and 12px gaps, card width is ~163px
- this is the main cause of claustrophobic cards

### 2) Demo styles are inline-injected in `LobbyPanel.ts`

`buildDemosTab()` injects a long CSS string via `UIStyles.injectCSS("demo-tab", ...)`.
This differs from project style (`LobbyPanel.css`, `MatchLobbyView.css`, component CSS files).

### 3) Levelshot assets are not present yet in repo

Current repo state:
- no `public/data/levelshots/` directory
- no `levelshot` entries in `public/data/pk3_manifest.json`
- `DemoInfo` has no image field

Product decision for this ticket (confirmed):
- assume `public/data/levelshots/<map>.png` as the convention
- map id is the BSP id from demo header (example: `wdm2.png`)

### 4) Playback event chain is currently incomplete

In `LobbyPanel.ts`:
- PLAY dispatches `window.dispatchEvent(new CustomEvent("demoplay:start", ...))`
- HIGHLIGHTS dispatches `window.dispatchEvent(new CustomEvent("demoplay:cinematic", ...))`

Repo-wide search result:
- no listeners for those events

Related dependency gap:
- `DemoPlayCommand` creates `DemoViewer`, but `Game.ts` has no demo integration path and no `DemoViewer.onFrame(...)` bridge

Implication:
- even after DemoReader parse fixes, current button flow is still not end-to-end reliable

### 5) Error handling is still silent to users

Both buttons catch errors and only call `console.error(...)`.
No in-UI feedback appears in the demos tab.

### 6) Duration picker is not style-system aligned

`DurationPickerModal.ts` is fully inline-styled with `style.cssText`, not class-based CSS.
It works, but is inconsistent with the lobby component styling approach.

## Resolved Open Questions

1. **Levelshot assets**
- Decision: use `public/data/levelshots/<map>.png` naming convention.
- Example: `wdm2` -> `/data/levelshots/wdm2.png`.

2. **Event listeners for demoplay events**
- Verified: none exist.
- Action: do not rely on custom window events for this ticket.

3. **Performance for many levelshots**
- Decision: preload levelshots during startup loading flow (same spirit as other warm-up work), then lazy-resolve any misses when demo list arrives.

4. **DurationPickerModal consistency**
- Action: convert to class-based styling in a CSS file.

5. **Minimum card width / breakpoints**
- Root cause is not only breakpoints; it is demos tab width cap.
- Action: remove demos tab width cap and move grid to `auto-fit/minmax`.

## Implementation Plan

### Phase 0 - Stabilize action behavior (required before visual polish)

Files:
- `src/engine/ui/panels/LobbyPanel.ts`

Changes:
- Replace `demoplay:start` / `demoplay:cinematic` window event dispatch with explicit action calls.
- Recommended path for this ticket: execute existing console command flow after `fetchAndLoad`.
  - normal: `demoplay`
  - highlights: `demoplay cinematic <minutes>`
- Add user-visible error state in demos tab (inline banner/toast row) for:
  - fetch failure
  - parse failure
  - command failure

Note:
- This removes the guaranteed no-listener failure.
- Full demo renderer wiring remains a separate dependency risk.

### Phase 1 - Data model support for levelshot banner

Files:
- `src/lobby/types.ts`
- `src/lobby/LobbyServer.ts`

Changes:
- Add optional field to `DemoInfo`:
  - `levelshot?: string`
- Populate in `_scanDemos()` with:
  - `levelshot: "/data/levelshots/${header.map}.png"`
- Keep fallback behavior in client if image fails to load.

### Phase 2 - Layout and visual redesign of demo cards

Files:
- `src/engine/ui/panels/LobbyPanel.ts`
- `src/engine/ui/panels/styles/LobbyPanel.css`
- `src/engine/ui/panels/styles/DemoTab.css` (new)

Changes:
- Move all demo-tab CSS out of inline injection to `DemoTab.css`.
- Inject `DemoTab.css` once in constructor (same pattern as other panel css imports).
- Add missing full-width overrides for demos tab:
  - include `.game-panel:has(.lobby__demos)` in width/padding override selectors.
- Replace fixed 4-column grid with responsive min width:
  - `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));`
- Card visual updates:
  - banner uses `background-image: url(levelshot)` when available
  - map/player hierarchy emphasized
  - gametype chip, bracket accents, scanline overlay
  - fallback gradient when levelshot missing
- Button polish:
  - min 12px font
  - larger hit area
  - hover glow aligned with `lobby__find-btn`

### Phase 3 - Levelshot preload strategy

Files:
- `src/main.ts`
- `src/engine/ui/LoadingScreen.ts` (status text only, optional)
- `src/engine/ui/panels/LobbyPanel.ts`
- `src/engine/ui/*` helper file (new, small image preload utility)

Changes:
- During startup/loading flow, preload known lobby map levelshots (current map pool ids) with non-blocking image prefetch.
- When welcome/demo data arrives, preload any additional map levelshots not already cached.
- Preload should be best-effort:
  - no hard fail on 404
  - continue to gradient fallback if missing

### Phase 4 - Duration picker consistency cleanup

Files:
- `src/games/fps/client/DurationPickerModal.ts`
- `src/games/fps/client/styles/DurationPickerModal.css` (new)

Changes:
- Replace inline `style.cssText` with class names.
- Keep existing behavior and keyboard handling.
- Align typography, borders, and glow tokens with lobby styles.

## Validation Plan

### Headless-first (required)

Run:

```bash
npm run cli:game -- --exec "map wdm2; bsp info; quit"
npm run cli:game -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
npm run test:simulation
npm run test:physics
```

### UI/manual checks

1. Start app and open lobby demos tab.
2. Confirm demos tab now uses full panel width (not narrow 720px layout).
3. Confirm cards reflow with readable widths across desktop and narrow widths.
4. Confirm levelshot image is shown when `/data/levelshots/<map>.png` exists.
5. Confirm fallback gradient when levelshot is missing.
6. Confirm PLAY/HIGHLIGHTS failures show visible UI error (not just console).
7. Confirm highlight duration modal matches lobby style language.
8. Confirm scrolling and tab switch performance with many demo cards remains smooth.

## Assumptions

- `public/data/levelshots/<map>.png` is the canonical path and filename convention.
- Some maps may not have a levelshot initially; fallback visuals are acceptable.
- Startup preload is best-effort and should not block app startup if images are missing.

## Unverified / Risks

- Demo playback pipeline still has deeper integration risk outside this UI ticket:
  - no current `demoplay:*` event listeners
  - no verified `DemoViewer.onFrame` bridge in `Game.ts`
- If playback still appears inert after Phase 0 command bridging, a follow-up ticket is required to wire demo viewer frames into render flow.
