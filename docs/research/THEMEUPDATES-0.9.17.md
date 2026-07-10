# Theme Updates — v0.9.17 "Washoi Manga" UI rollout

Date: 2026-07-10
Status: in progress, on `feature/manga-lobby-ui` (both repos), unmerged / unpushed
Branch: `feature/manga-lobby-ui` — outer repo **and** fps submodule

## Goal

Bring the **whole front-end UI** into the "washoi manga" visual language that the
combat **HUD** and the **ESC / pause menu** already use. Every menu surface
should read as one cohesive comic-print system, not a stack of differently-styled
screens.

## The style (definitive spec)

The reference is the **ESC menu** (`.fps-pause-*` in
`src/engine/ui/hud/styles/WashikiTheme.css`) and the combat HUD. It is a
**dark-navy neon print-slab** look — NOT paper-cream.

> ⚠️ **Direction gotcha (already corrected):** an earlier pass styled the lobby
> side columns as cream/newsprint slabs. That read as *older/other* UI and was
> rejected. The house style is **dark navy + neon**. Cream (`--w-cream`) is used
> only as a rare spot material, never as a panel ground. Don't reintroduce it.

### Core devices

| Device | Value / how |
| --- | --- |
| Panel ground | `linear-gradient(135–138deg, hsla(238,34-36%,9%,.9), hsla(245,42%,5%,.9))` over `var(--w-scan-cyan)` (scanlines) |
| Neon edge | `border: 2px solid hsla(180,100%,50%,.28)` **and/or** `inset 0 0 0 2px hsla(180,100%,50%,.45)` |
| Inset edge-bar | `inset 5px 0 0 hsla(180,100%,50%,.4)` — a colored bar down the left of every slab; flips to gold on hover |
| Hard shadow | `4–14px 5–14px 0 hsla(0,0%,0%,.32–.4)` — **black, offset, no blur** |
| Clip corners | `clip-path: polygon(...)` — angled/cut corners (parallelogram tabs, cut bottom-right) |
| Stamp label | dark ink text `hsl(246,38%,7%)` on a **gold/cyan/magenta** fill + clip-path + small hard shadow |
| Heading | light `var(--w-text)` + **magenta** offset text-shadow (`3px 3px 0 hsla(320,100%,60%,.8)`) |
| Hover | `transform: translate(-2px,-2px)` + bigger shadow + gold inset bar |
| Press | `transform: translate(1px,1px)` + smaller shadow |
| Fonts | `--w-font-display` (Orbitron) for labels/headings, `--w-font-body` (Rajdhani) for text |

### Accent semantics (keep consistent everywhere)

- **Cyan** (`--w-cyan` 180) = structure / default / neutral interactive
- **Gold** (`--w-gold` 45) = the primary action (RESUME, FIND, READY, WATCH-hover)
- **Magenta** (`--w-magenta` 320) = live / danger / destructive (DISCONNECT, LEAVE, LIVE, error) **and team "bravo/soba"**
- **Team colors**: alpha/udon = **cyan**, bravo/soba = **magenta** (matches `RemotePlayerRenderer` team tint)
- Status dots: green `hsl(140,80%,55%)` online, gold searching, magenta in-game (glow via `box-shadow`)

### Tokens

Shared tokens live in `src/engine/ui/hud/styles/WashikiTheme.css` `:root`
(`--w-cyan/-magenta/-gold`, `--w-text/-muted/-dim`, `--w-scan-cyan`,
`--w-ink`, `--w-shadow-print-*`, `--w-font-*`). They are global once the theme
CSS is injected, so any surface can use them.

Per-surface, define a small **local helper block** so slabs stay consistent:

```css
.my-surface {
  --l-flat: hsla(238, 38%, 8%, 0.66);            /* flat slab fill */
  --l-card: linear-gradient(138deg, hsla(238,36%,9%,.92), hsla(245,42%,5%,.92));
  --l-scan: var(--w-scan-cyan);
  --l-shadow: 4px 5px 0 hsla(0,0%,0%,0.34);
  --l-shadow-sm: 3px 3px 0 hsla(0,0%,0%,0.3);
  --l-ink: hsl(246, 38%, 7%);
}
```

## Recipe / cheat-sheet

**Stamp label (section title, count, status):**
```css
padding: 4px 12px; color: var(--l-ink); background: var(--w-gold);
clip-path: polygon(6% 0, 100% 0, 94% 100%, 0 100%);
box-shadow: 3px 3px 0 hsla(320,100%,60%,0.55);   /* magenta hard shadow */
```

**Slab row (list item / slot):**
```css
background: linear-gradient(92deg, hsla(180,100%,50%,.08), hsla(0,0%,100%,.03) 60%), var(--l-flat);
border: 1.5px solid hsla(180,100%,50%,.26);
clip-path: polygon(2% 0, 100% 0, 98% 100%, 0 100%);
box-shadow: var(--l-shadow-sm), inset 4px 0 0 hsla(180,100%,50%,.4);
/* hover: translate(-2px,-1px); inset bar → gold */
```

**Card / mini fight-ticket:** as slab row but `--l-card` + `var(--l-scan)`, `border: 2px`,
`clip-path: polygon(0 0,100% 0,100% 86%,95% 100%,0 100%)` (cut bottom-right), `var(--l-shadow)`.

**Neon button (WATCH / action):**
```css
border: 1.5–2px solid hsla(180,100%,50%,.4);
background: linear-gradient(92deg, hsla(180,100%,50%,.2), hsla(0,0%,100%,.05) 60%), hsla(238,38%,8%,.9);
color: var(--w-text); clip-path: polygon(7% 0,100% 0,93% 100%,0 100%);
box-shadow: 3–4px 3–5px 0 hsla(0,0%,0%,.34), inset 4–5px 0 0 hsla(180,100%,50%,.44);
/* hover: translate(-2px,-1px); border+color+inset → gold */
```

## Done this cycle

| Surface | File(s) | Repo | Notes |
| --- | --- | --- | --- |
| Matchmaking tickets | `client/LobbyPanel.{ts,css}` | fps | pre-existing (0.9.16) — the origin of the style |
| Lobby **Social + Chat** columns | `client/styles/LobbyPanel.css`, `client/LobbyPanel.ts` (label span) | fps | players list, live-match mini-tickets, chat — commit `46ab507` |
| **Ready-room** (`MatchLobbyView`) | `engine/ui/components/styles/MatchLobbyView.css` | outer | header poster, map-vote fight-tickets, team stamps (cyan/magenta), slots w/ inset bars, URL slab, LEAVE(magenta)/SHUFFLE(gold)/READY(gold-fills-when-active) |
| **Connecting overlay** (`ConnectingOverlay`) | `engine/ui/components/styles/ConnectingOverlay.css` | outer | "GAME STARTING" poster: navy panel, gold→magenta top bar, magenta-shadow heading, gold status stamp, cyan sweep bar, magenta error stamp |

All CSS-only except a one-line `sectionTitle()` label-span wrap in `LobbyPanel.ts`.
`tsc --noEmit` clean throughout. **Visual-only — needs a browser eyeball**
(`npm run lobby:server` + `npm run dev`, no headless check possible).

## Remaining surfaces (checklist)

Still on the old/other styling — apply the recipe above:

- [ ] Lobby **Leaderboard** tab (`buildLeaderboardTab`, `.lobby__leaderboard*`)
- [ ] Lobby **Profile** tab (`buildProfileTab`, `.lobby__profile*`)
- [ ] Lobby **Settings** view (`FPSSettingsView` / `settings/`)
- [ ] Lobby **Demos** tab (`buildDemosTab`, `styles/DemoTab.css`)
- [ ] The **GamePanel** shell itself (`engine/ui/panels/GamePanel.{ts,css}`) — tabs, header, footer, particles/logo — so every tabbed surface inherits the frame
- [ ] Generic engine components: `Button`, `Overlay`, `MapLoadingOverlay`, toasts/modals
- [ ] Spectator overlay, killfeed/HUD widgets not yet on the print-slab system
- [ ] In-match **scoreboard** and **settings** dialogs
- [ ] Consider promoting the repeated `--l-*` helper block + recipe into shared
      classes/tokens in `WashikiTheme.css` (e.g. `.w-slab`, `.w-stamp`, `.w-btn`)
      so surfaces stop re-declaring them (plan step 1 in
      `v0.9.16-gameplay-and-ui-improvements.md`).

## Branch / commit / validation state

- **fps** `feature/manga-lobby-ui`: `46ab507` (lobby Social+Chat restyle), off fps `main` (`4a2d145`).
- **outer** `feature/manga-lobby-ui`: ready-room + overlay CSS + this doc + submodule pin → fps `46ab507`. Off outer `main` (`c79c011`).
- Both **unmerged, unpushed**. When ready to land: **fps first** (push + merge to main), then re-pin outer to fps main tip, then merge+push outer (per `AGENTS.md`).
- Independent of the pending **blade-drop fix** on `feature/v0.9.17-fixes` (that branch is unrelated; keep them separate or merge both to main in either order).

## Gotchas

- **Don't go cream.** See the direction gotcha above.
- **CSS is validated visually only.** `tsc` never sees it. `MatchLobbyView.css`
  is loaded via `?raw` + `UIStyles` injection (from `LobbyPanel.ts`);
  `ConnectingOverlay.css` is a normal Vite `import`. Neither is type-checked.
- **Fonts in mockups:** Orbitron/Rajdhani can't load in the Artifact sandbox
  (CSP blocks font CDNs) — previews fall back to a system condensed face; colors
  and slabs are faithful but type looks different than in-game.
- **Two repos:** engine UI primitives/components live in the **outer** repo
  (`src/engine/ui/`); FPS-specific screens (LobbyPanel, HUD widgets) live in the
  **fps submodule** (`src/games/fps/client/`). A theme pass usually touches both.
- Preview artifact of the lobby direction (dark-navy, matches ESC menu):
  https://claude.ai/code/artifact/e83e3dcf-96ad-4803-945a-79d99bce1426
