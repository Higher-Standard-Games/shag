# In-Game UI System — Research & Brainstorming

## Vision

Replace the current small floating dialog-box UI (settings, menus) with an **immersive full-screen panel system** inspired by the washoi-net website. The game world peeks through at the edges via blur, while the center area provides a premium, animated UI surface with floating particles, neon divider lines, and the existing Washiki design language.

**Goal:** Every full-screen UI in the game (settings, server browser, team select, end-game stats) should feel like opening a cyberpunk holographic terminal — not a generic modal dialog.

---

## Reference: washoi-net Website Effects

Source: `C:\Users\sundf\Desktop\washoi-net\src\`

### Visual Effects Inventory

| Effect | Source File | What It Does | Performance |
|--------|-----------|--------------|-------------|
| **Floating Particles** | `FloatingParticles.tsx` | 30 sparkles/shards/dots in cyan/magenta/gold. Float, drift, fade, scale on infinite loops. Each particle has randomized position, delay, duration, shape. Glow via `box-shadow` | Very cheap — just `<div>`s with CSS `animation` |
| **Neon Rain** | `RainEffect.tsx` + `.css` | Thin vertical droplets falling with `translateY` animation. Cyan gradient `transparent → hsl(180 80% 70% / 0.4)` | Cheap — CSS-only `@keyframes rain-fall` |
| **Speed Lines** | `SpeedLines.tsx` | 40 radial gradient lines from center outward at different angles. Scale-in on appear | One-shot entrance effect, not looping |
| **Angled Dividers** | `MangaDecorations.tsx` → `MangaDivider` | SVG `<polygon>` + `<line>` creating diagonal section cuts with neon stroke | Static SVG, very cheap |
| **Corner Brackets** | `MangaDecorations.tsx` → `MangaPanel` | Four `<div>` corners with 2px borders in cyan (TL), magenta (TR, BL), gold (BR) | Static CSS, zero cost |
| **Section Headers** | `MangaDecorations.tsx` → `SectionHeader` | Title + gradient underline + decorative dot/dash pattern (cyan•magenta•gold) | Static |
| **Kanji Watermarks** | `MangaDecorations.tsx` → `KanjiWatermark` | Giant Japanese characters at 3% opacity behind content | Static, `pointer-events: none` |
| **Pulse Neon** | `index.css` | `@keyframes pulse-neon` — opacity oscillates 1.0 → 0.7 → 1.0 | Trivial CSS |
| **Float** | `index.css` | `@keyframes float` — `translateY(0 → -10px → 0)` | Trivial CSS |
| **Scan Line** | `index.css` | Horizontal line sweeping top to bottom | Trivial CSS |

### Color System (already in WashikiTheme.css)

```
Cyan:    hsl(180, 100%, 50%)  — primary, UI lines, active states
Magenta: hsl(320, 100%, 60%)  — secondary, accents, hover states  
Gold:    hsl(45, 100%, 55%)   — tertiary, warnings, special
```

Each has glow variants: `0 0 20px color/0.6, 0 0 60px color/0.3`

---

## Proposed Architecture

### The GamePanel — Full-Screen UI Shell

The core reusable element. A full-viewport overlay with three visual zones:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   BLUR ZONE — blurred game world shows through           │
│                                                          │
│ ╱══════════ ANGLED NEON DIVIDER LINE (top) ═══════════╲  │
│╱                                                        ╲│
│██████████████████████████████████████████████████████████ │
│██                                                      ██│
│██   SOLID ZONE — dark bg + particles + kanji           ██│
│██                                                      ██│
│██   ┌─── TAB BAR ────────────────────────┐             ██│
│██   │ ⌐VIDEO¬  ⌐AUDIO¬  ⌐CONTROLS¬      │             ██│
│██   └────────────────────────────────────┘             ██│
│██                                                      ██│
│██   ┌─── SCROLLABLE CONTENT ─────────────┐             ██│
│██   │                                    │ ▐▌ scrollbar██│
│██   │   (settings / server list / etc)   │             ██│
│██   │                                    │             ██│
│██   └────────────────────────────────────┘             ██│
│██                                                      ██│
│██████████████████████████████████████████████████████████ │
│╲                                                        ╱│
│ ╲══════════ ANGLED NEON DIVIDER LINE (bottom) ════════╱  │
│                                                          │
│   BLUR ZONE — blurred game world shows through           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Key idea from brainstorming:** The divider lines are the existing vertical UI border lines but *slightly rotated* (~3-5°). Between them = solid dark background. Outside = blurred gameplay. This creates a "holographic screen floating in the game world" feeling.

### Zone Breakdown

| Zone | CSS Approach | Content |
|------|-------------|---------|
| **Blur strips** (top/bottom ~12-15% height) | `backdrop-filter: blur(12px)` on overlay pseudo-element, masked to only cover these strips | Game world visible but softened |
| **Divider lines** | SVG `<line>` elements with `stroke: linear-gradient(cyan, magenta)` + `filter: drop-shadow()` for glow. Slight angle via `transform: rotate(2deg)` | Purely decorative frame |
| **Solid center** (~70% height) | `background: hsla(240, 20%, 5%, 0.92)` — near-opaque dark | All interactive UI lives here |
| **Particles layer** | Absolutely positioned `<div>`s with CSS `animation` inside center zone | Ambient sparkles drifting through |
| **Kanji watermarks** | Large characters at `opacity: 0.03`, `pointer-events: none` | Background texture |

---

## Reusable Component Inventory

### Tier 1 — Effect Primitives (CSS-only, no logic)

#### `FloatingParticles`

- **What:** ~20-25 small colored shapes floating slowly through the panel
- **Shapes:** dots (border-radius: 50%), shards (tall rectangles, rotated), sparkles (tiny squares)
- **Colors:** Randomized from cyan/magenta/gold palette
- **Animation:** CSS `@keyframes` — slow vertical drift (`translateY`), horizontal wobble, fade in/out, scale pulse
- **Glow:** Each particle gets `box-shadow: 0 0 Npx color` matching its size
- **Performance:** Pure CSS animation, GPU-composited via `transform` + `opacity`. No JS per frame
- **Lifecycle:** Created once on panel open, removed on close

#### `NeonDivider`

- **What:** Angled line with gradient neon glow, used as top/bottom frame border
- **Implementation:** SVG `<line>` with `stroke` gradient or CSS `border` on rotated `<div>`
- **Glow:** `filter: drop-shadow(0 0 8px cyan) drop-shadow(0 0 20px cyan/0.3)`
- **Variants:** `top` (slight clockwise angle), `bottom` (mirrored)
- **Optional:** Subtle pulse animation on the glow intensity

#### `KanjiWatermark`

- **What:** Decorative Japanese characters behind content
- **Characters:** 闘 (fight), 速 (speed), 力 (power), 魂 (soul), 技 (technique)
- **Style:** `font-size: 12rem`, `opacity: 0.03`, `font-family: Orbitron` or system serif
- **Placement:** 1-2 characters, offset from center, slight rotation
- **Optional:** Very slow drift animation (0.5px/s)

#### `ScanLine`

- **What:** Thin horizontal line sweeping slowly top-to-bottom across the panel
- **Style:** 1px height, cyan at 10% opacity, full width
- **Animation:** `translateY(-100%) → translateY(100vh)` over ~8 seconds, infinite loop
- **Feel:** CRT monitor / holographic display

### Tier 2 — Structural Components (DOM builders with interactivity)

#### `GamePanel` (the big one)

- **Extends/replaces:** Current `MangaPanelDialog` behavior for full-screen UIs
- **Creates:** Full viewport overlay with blur zones + solid center + effects
- **API:**

  ```typescript
  class GamePanel {
    protected headerArea: HTMLElement;   // For title / tab bar
    protected contentArea: HTMLElement;  // Scrollable content zone
    protected footerArea: HTMLElement;   // Action buttons
    
    open(): void;   // Show with entrance animation
    close(): void;  // Hide with exit animation
    
    setTitle(title: string): void;
    onClose(callback: () => void): void;
  }
  ```

- **Entrance animation:** Divider lines slide in from edges, center fades up, particles spawn
- **Exit animation:** Reverse — particles fade, center fades down, lines retract

#### `PanelTabBar`

- **What:** Horizontal tab navigation
- **Style:** Each tab button has manga-panel corner brackets. Active tab gets:
  - Brighter text (white vs muted gray)
  - Neon cyan underline bar with glow
  - Slightly brighter background
- **API:**

  ```typescript
  class PanelTabBar {
    addTab(id: string, label: string): void;
    setActive(id: string): void;
    onTabChange(callback: (tabId: string) => void): void;
  }
  ```

- **Ideas to try:**
  - Tabs as manga-panel cards with corner brackets
  - Tabs as simple text with underline indicator (cleaner?)
  - Tabs with small icons (⚙ Video, 🔊 Audio, 🎮 Controls)

#### `ScrollPane`

- **What:** Scrollable content container with styled scrollbar
- **Scrollbar:** Thin (6px), track = dark, thumb = cyan with glow
- **Edge fade:** Top/bottom gradients (via CSS `mask-image: linear-gradient(...)`) so content doesn't hard-cut at edges
- **Smooth:** `scroll-behavior: smooth`, touch-friendly momentum

#### `NeonButton`

- **What:** Enhanced button with corner brackets matching website CTA style
- **Already partially exists:** `fps-btn` class in current system
- **Enhancement:** Add corner bracket pseudo-elements, hover glow, color variants (cyan/magenta/gold)

#### `SectionHeader`

- **What:** Section title within content area
- **Style:** Orbitron uppercase text + decorative dot/dash underline pattern
- **Pattern:** `cyan-dot • cyan-dash — magenta-dot • magenta-dash — gold-dot`

---

## Implementation Priority

### Phase 1: Foundation (GamePanel)

Build `GamePanel` with blur zones, neon dividers, floating particles, and kanji watermarks. This is the reusable shell that makes everything look premium.

**Files:**

- `src/engine/ui/panels/GamePanel.ts` — The base class
- `src/engine/ui/panels/effects/FloatingParticles.ts` — Particle spawner
- `src/engine/ui/panels/effects/NeonDivider.ts` — SVG divider line
- `src/engine/ui/panels/effects/KanjiWatermark.ts` — Background decoration
- `src/engine/ui/hud/styles/GamePanel.css` — All styles + keyframes

### Phase 2: Interaction Layer

Build `PanelTabBar` and `ScrollPane` on top of GamePanel.

**Files:**

- `src/engine/ui/panels/PanelTabBar.ts`
- `src/engine/ui/panels/ScrollPane.ts`

### Phase 3: Settings Panel Migration

Refactor `SettingsOverlay.ts` to extend `GamePanel` instead of `MangaPanelDialog`. Wire up tabs via `PanelTabBar`, content via `ScrollPane`.

**Files:**

- `src/games/fps/client/hud/widgets/SettingsOverlay.ts` — Refactored

### Phase 4: Other Screens (future)

Migrate other dialogs: team select, server browser, end-game stats, player profile.

---

## Open Questions / Ideas to Try

- **Divider line angle:** 2° vs 5° vs more? Need to test what looks good at 1920×1080
- **Particle count:** 15 for subtle vs 30 for lively? Performance test needed
- **Tab style:** Corner brackets vs underline indicator vs both?
- **Entrance animation:** Fast snap-in (100ms) vs dramatic slide (400ms)?
- **Should scanline effect be default or optional?** Might be distracting during settings
- **Footer buttons:** Inside the solid zone (current) or overlapping the bottom divider line?
- **Content max-width:** Full panel width vs centered ~800px for readability?
- **Multiple panels open?** Settings over pause menu? Or one-at-a-time?

---

## Performance Budget

Target: **zero measurable frame drop** when panel is open.

| Element | DOM Nodes | Animations | GPU Impact |
|---------|-----------|------------|------------|
| Blur zones | 2 | 0 (static filter) | Low — `backdrop-filter` on 2 rects |
| Divider lines | 2 SVGs | Optional glow pulse | Negligible |
| Particles | 20-25 divs | 20-25 CSS animations | Low — `transform` + `opacity` only (GPU-composited) |
| Kanji watermarks | 1-2 spans | 0 or 1 slow drift | Negligible |
| Scan line | 1 div | 1 CSS animation | Negligible |
| **Total** | **~30 nodes** | **~25 CSS animations** | **Low** |

The website runs 30+ particles with framer-motion (heavier than CSS) at 60fps. Our CSS-only approach should be even lighter.
