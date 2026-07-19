# Electrobolt — Investigation & Brainstorm

**Status:** decisions locked 2026-07-19 — directed plan + work order below (§6)
**Date:** 2026-07-19
**Weapon identity:** **instant hitscan sniper** (rail/bolt) — semi-auto, high single-shot damage, ADS zoom, long range. NOT a continuous beam.
**Sibling reference:** [`VOLTAIC_DESIGN.md`](./VOLTAIC_DESIGN.md) — reuse the renderer *grammar* (analytic quad, GPU field, wire-truth endpoint), never the continuous-beam behavior.

**Locked decisions (2026-07-19):**
1. **Glow fix:** easiest / minimal (A1 — wire `_glow.tga` as additive emissive on the viewmodel material).
2. **VFX:** full analytic-rail rebuild. Leave the old `fireBolt` cylinder path in place (ignore dead code — no cleanup pass).
3. **Wire-truth endpoint:** yes — one-shot authoritative rail endpoint on the wire.
4. **Name:** keep **Electrobolt** (no rename).
5. **Instagun:** out of scope this cycle (not in use); stays on `fireBolt`.

---

## 0. TL;DR

Three separable threads, in priority order:

1. **The model glow is broken** — the energy-coil glow is not applied as an additive emissive, so it renders as flat saturated RGB / black (the stripe in the screenshots). Concrete asset + code cause found; several fix options.
2. **The shot VFX is the old two-cylinder rail** — the exact approach Voltaic just replaced. Can be rebuilt on the Voltaic analytic-shader grammar, adapted to an *instant* rail with a sniper payoff.
3. **Name** — like `lasergun → Voltaic`, Electrobolt could take a new identity. Shortlist below.

---

## 1. Source audit

### 1.1 Gameplay (out of scope to change here)

`src/shared/entities/definitions/weapons/electrobolt.ts`:

- `damage: 75`, `range: 10000`, `fireRate: 0.8` (semi), `hitscanType: "bolt"`, `reloadModel: "pool"`, `ammoType: "bolts"` (`BOLT_AMMO`).
- Sniper kit: `ads.fovReduction: 25`, `ads.sensitivity: 0.3`, `speedBonus: -25`, `knockbackScale: 3.5`.
- Muzzle flash electric blue `{0.3, 0.5, 1.0}`, intensity 35.
- Server trace is the instant hitscan-"bolt" path in `WeaponSystem` (shared class with instagun).

**Design constraint:** whatever we do visually must read as *one instantaneous, precise, powerful shot* — not a held tether. This is the opposite of Voltaic's continuous grammar even though the underlying shader tech can be shared.

### 1.2 Current shot VFX

`src/engine/weapon/HitscanEffects.ts` → `fireBolt()` (shared by electrobolt + instagun):

- A thick **core cylinder** (`StandardMaterial`, emissive, alpha 0.9) + a wider **glow cylinder** (alpha 0.25) + an impact flash light + a scorch `spawnWallMark`, fading over ~0.4 s.
- Mesh-per-shot; endpoint from a **client-side `traceRay`** — the same "local pick may disagree with the server" class Voltaic just fixed for beams.
- Dispatch: `src/games/fps/client/GameEvents.ts` `handleRemoteWeaponFire` → `case "electrobolt"/"instagun": fx.fireBolt(...)`. Color `WEAPON_EFFECT_COLORS.electrobolt = [0.3, 0.6, 1.0]`.

This is functional but is exactly the cylinder-chain aesthetic the Voltaic audit rejected (pipe silhouette, no analytic core, mesh churn, no authoritative endpoint).

### 1.3 The model & the glow bug (the stripe)

Assets in `public/data/models/weapons/electrobolt/`:

| File | Size | Role |
|---|---:|---|
| `electrobolt.glb` | 1.68 MB | viewmodel (IQM→GLB), textures embedded |
| `electrobolt.tga` | 3.1 MB | diffuse/albedo |
| `electrobolt_norm.tga` | 3.1 MB | normal |
| `electrobolt_gloss.tga` | 243 KB | gloss/spec |
| `electrobolt_glow.tga` | **262 KB** | **the real energy-coil glow map** |
| `electrobolt_emit.tga` | **172 bytes** | near-empty placeholder |
| `electrobolt.ktx` / `elextrobolt.ktx` | 5.6 MB each | compressed dup — note the **typo** in the second |

Code path — `src/engine/weapon/WeaponViewManager.ts` `loadGlbWeapon`, gun branch (~line 594):

```
// Gun-type weapons: keep PBR material for proper metallic/roughness
pbr.environmentIntensity = 2.0; ...
```

The gun path **keeps the GLB's baked PBR material and never wires an emissive/glow texture**. So the coil glow is only whatever the GLB baked at conversion — and the 172-byte `_emit` strongly suggests the emissive channel was bound to an empty texture, leaving `_glow.tga` (the actual colored energy coil) unused. Result: the coil region renders as flat unlit albedo (the saturated red/green/blue blocks) or black, instead of an additive electric-blue glow.

Corroborating contrast: the Lasergun/Voltaic model renders its glow correctly, and its `_emit.tga` is 3.1 KB (real) vs Electrobolt's 172 bytes — so this is an **Electrobolt-specific asset/binding defect**, not a general gun-material bug.

Existing infra we already own: `src/engine/loader/shader/GlowOverlayShaderMaterial.ts` implements `final = base*lightmap + glow` (additive), but it's wired only to **BSP world surfaces** (`BspMeshBuilder`), never to weapon models.

---

## 2. Problem A — fix the model glow

Goal: the energy coil glows electric-blue additively (bright, self-lit), dark elsewhere, readable on bright and dark maps, bloom-independent. Verification is visual (not headlessly testable).

Options (decide at implementation time):

- **A1 — Gun-path emissive wire (minimal).** In the gun branch, set `pbr.emissiveTexture = <electrobolt_glow>`, `emissiveColor = white`, tuned `emissiveIntensity`. Keeps PBR metallic/roughness; only lights the coil. Requires the glow to share the base UV set (IQM glow maps usually do).
- **A2 — Glow submesh → StandardMaterial (like the blade path).** Identify the coil submesh and give it a self-lit `StandardMaterial` (emissive = `_glow`, `disableLighting`, additive/alpha), leave the body PBR.
- **A3 — Reuse `GlowOverlayShaderMaterial` on the coil submesh.** The engine already owns the additive `base + glow` shader; extend it from BSP to this one weapon submesh.
- **A4 — Re-bake upstream.** Fix the IQM→GLB conversion so emissive = `_glow`, delete the dead 172-byte `_emit` and the typo `elextrobolt.ktx`. Cleanest long-term; needs the asset pipeline.

Recommendation: prototype **A1** first (smallest, PBR-preserving); fall back to **A2/A3** if the glow UV or submesh split makes A1 impractical. Independent of the VFX rebuild — this fix stands alone and could land first.

---

## 3. Problem B — the shot VFX (brainstorm)

**Anchor:** one instantaneous rail per shot, precise, powerful, readable at 10 000 u, with a strong terminal payoff and a crack. Reuse Voltaic's *tech*, invert its *behavior* (single-shot decay, not sustained).

### 3.1 What transfers directly from Voltaic

- The analytic **single-quad + GPU shader** approach (`voltaic/VoltaicShaderMaterial`, `VoltaicBeamGeometry`): straight invariant core, corona, endpoint envelopes, camera-facing hybrid width, HDR for bloom, no per-shot mesh churn.
- **Authoritative endpoint on the wire.** Emit a one-shot rail event (endpoint + normal + impact kind), mirroring `voltaic_beam`, so the visual endpoint equals the damage endpoint and stops through-wall / max-range client-pick rails. One-shot, not per-tick.
- **Thin-instanced batch** for concurrent rails (multiple snipers, rapid re-fires while the previous rail is still fading).

### 3.2 Electrobolt's own identity (must NOT look like Voltaic)

- **Instant rail with a short afterglow** (~0.4–0.7 s decay), not a persistent tether. The core appears full-length for 1 frame, then fades.
- **Classic rail helix** — a tight, fast, cold double-helix wrap, drawn as an analytic shader field (reuse Voltaic's quadrature front/back-dim trick) rather than helix geometry. Reads instantly as "railgun."
- **Sniper payoff at both ends:** a sharp muzzle crack/flash and a bright terminal nucleus + impact ring — heavier than Voltaic's continuous contact crown, because this is a single 75-damage shot.
- **Hit tension on player hits:** brief core brighten + a compact electric burst; the shot should *feel* lethal.
- **Palette:** cold electric blue-white core, blue corona (keep `[0.3, 0.6, 1.0]`), vs Voltaic's warm amber — the two weapons must be instantly distinguishable when both are on screen.

### 3.3 Architecture (chosen)

- **Sibling `ProceduralRailRenderer`** under `src/engine/weapon/rail/`, reusing the Voltaic shader/geometry *grammar* (analytic camera-facing quad, hybrid width, HDR core + corona, endpoint envelopes) but owning a **one-shot instant lifecycle** (spawn full-length → fade ~0.5 s) and a **helix** field. Not the continuous `voltaic/` renderer — the behaviors are opposite.
- **Leave `fireBolt` in place** (decision 2 — ignore dead code). Instagun keeps using it (decision 5); only Electrobolt routes to the new renderer.

---

## 4. Naming — decided: keep **Electrobolt**

No rename this cycle (decision 4). The rename machinery (`canonicalWeaponId` + weapon/ammo `classnameAliases` + `PickupTable`/registration/bot normalization) is recorded above if we revisit it; for now the id/classname/ammo stay untouched.

---

## 5. Work order

Three work orders. **WO-EB1 is independent** and can land first; **WO-EB2 → WO-EB3** are sequential (the renderer consumes the wire endpoint). All three carry a visual check that can only be confirmed in a browser playtest.

### WO-EB1 — Fix the viewmodel glow (A1, easiest, independent)

**Goal:** the energy coil glows additive electric-blue; body stays dark; readable bloom on/off.
**Steps:**
1. Add optional `viewModel.glowTexture?: string` to `WeaponDef` (presentation-only).
2. `electrobolt.ts`: set it to `/data/models/weapons/electrobolt/electrobolt_glow.tga`.
3. `WeaponViewManager.loadGlbWeapon` gun path: when a def has `glowTexture`, load it and set the PBR material's `emissiveTexture` + `emissiveColor = white` (tuned intensity). A proper glow map is black except the coil, so only the coil lights.
**Proof:** guard test (a def with `glowTexture` → material has an emissive texture); **visual check owed**. Optional: delete the dead 172-byte `_emit` + typo `elextrobolt.ktx`.

### WO-EB2 — Authoritative one-shot rail endpoint on the wire

**Goal:** the rail's visual endpoint equals the damage endpoint (no through-wall / max-range client-pick rails).
**Steps:**
1. New `electro_rail` snapshot event (entity, origin, dir, end, normal, impactKind) — mirror `voltaic_beam` in `SnapshotEvent` + `BinaryProtocol` (byte-symmetric, next event id).
2. `WeaponSystem`: on a `bolt` fire, emit one rail event from the existing hitscan trace result (reuse the `emitVoltaicBeamEvent` pattern; presentation-only, determinism-safe).
3. `SnapshotBuilder` publishes (`toClientKey`); `GameEvents` adds the exhaustive `electro_rail` case.
**Proof:** wire round-trip test + exhaustive-dispatch compile check; `server:tick` checksum unchanged.

### WO-EB3 — Procedural rail renderer (full rebuild)

**Goal:** instant analytic rail replacing `fireBolt` for Electrobolt — cold blue-white core, helix wrap, sniper muzzle crack + terminal nucleus/impact ring, hit tension, ~0.5 s decay.
**Steps:**
1. `ProceduralRailRenderer` reusing the Voltaic quad/shader grammar; one-shot spawn→fade lifecycle; analytic helix (quadrature front/back dim); thin-instanced for concurrent rails.
2. Route Electrobolt fire (local + remote via the `electro_rail` event) to it; keep `fireBolt` for instagun.
3. Prewarm the shader (avoid the first-shot hitch).
**Proof:** renderer unit tests (lifecycle/profile/instance packing); **visual playtest owed** (first-person + remote, bright/dark maps, bloom, long-range readability).

---

*Decisions locked 2026-07-19. WO-EB1 is independent and low-risk (visual verification owed); WO-EB2 → WO-EB3 are sequential. Edit freely as implementation reveals detail.*
