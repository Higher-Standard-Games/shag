# Lobby UI papercuts, 2026-10-18

Room map votes now retain three equal card slots when the server offers zero,
one, two or three maps. Unused slots are native disabled buttons with no map
identifier, vote count, image request or click handler. A muted striped face and
Unavailable label distinguish them from real choices. Vote refreshes preserve
the layout. Existing responsive wrapping is unchanged.

Removed the decorative character from both the Esc-menu rail and the in-match
settings rail, including the unused shared CSS rule. The yellow background,
branding and controls remain. Other character artwork outside these sidebars
was outside the request. User-supplied levelshots were not edited or packaged.

Files changed:

- `src/engine/ui/components/MatchLobbyView.ts`
- `src/engine/ui/components/styles/MatchLobbyView.css`
- `src/engine/ui/components/__tests__/MatchLobbyView.test.ts`
- `src/games/fps/client/hud/widgets/PauseMenu.ts`
- `src/games/fps/client/hud/widgets/SettingsOverlay.ts`
- `src/games/fps/client/styles/MatchMenu.css`
- `docs/changelog/v0.9.32.md`
- `docs/manual/guides/lobby-server.md`
- `docs/research/LOBBY_UI_PAPERCUTS.md`

Validation:

- `npm run test:run -- src/engine/ui/components/__tests__/MatchLobbyView.test.ts`:
  26 passed, including 0/1/2/3 offered maps, disabled clicks and vote refresh.
- `npm run test:run -- src/engine/ui/components/__tests__/MatchLobbyView.test.ts src/games/fps/client/__tests__/LoadoutMenu.test.ts src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts`:
  44 passed after the menu decoration removal.
- `npm run typecheck`, `npm run build`, `npm run gate:biome`,
  `npm run docs:build`: pass. Logs `.cache/ui-papercuts-*` and
  `.cache/map-slots-docs.log`.
- `npm run test:run -- --maxWorkers=2`: 5,189 passed, one skipped, six failed.
  Five are the known editor compilation/material failures. The extra failure was
  `LobbyPanelRecovery.test.ts:121`, which observed one timer instead of zero.
  A focused rerun (`npm run test:run -- src/games/fps/client/__tests__/LobbyPanelRecovery.test.ts`)
  passed all seven tests. The full run is not claimed green; no recovery code
  was changed. Logs `.cache/map-slots-all-tests.log`, `.cache/ui-papercuts-recovery.log`.
- `node .cache/map-slots-probe.mjs`: actual component, headless Edge, 1/2/3
  offered maps all produced three 502-pixel-wide cards at the probe viewport;
  disabled clicks sent no votes. No browser errors or failed HTTP requests.
  Screenshot `.cache/map-slots-1.png` inspected.
- `node .cache/menu-background-probe.mjs`: actual Esc and settings components,
  both with zero character elements and no browser errors/failed requests.
  The probe raised the overlay above the lobby for inspection; it did not play
  a live match. `.cache/menu-background-esc.png` inspected.
- `git diff --check` and FPS submodule `git diff --check`: pass.

No renderer or network protocol logic changed. A live match/menu transition
and narrow-screen layout were not separately tested. Browser probes and their
private Vite process were closed; user services were left running.
