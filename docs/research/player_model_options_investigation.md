# Player Model Visibility Options Investigation

**Date:** 2026-07-13  
**Scope:** Investigate whether SHAG can expose client-side options for enemy model color, enemy outline color, and a visibility/fullbright boost that preserves model texture detail.

## Short Answer

Yes. The current renderer already has most of the required hooks:

- Remote player models are created through `RemotePlayerRenderer` and `PlayerModelManager`.
- `PlayerModelManager.applyTeamColor()` already clones each player instance material and overrides PBR `albedoColor` per player.
- Babylon mesh outlines are already used successfully on weapon meshes through `mesh.renderOutline`, `mesh.outlineWidth`, and `mesh.outlineColor`.
- The engine also has a global cel-outline post-process, but that is scene-wide and not a good fit for per-enemy outline color.
- There is no existing player-model silhouette outline cvar. The current outline cvars are global cel/world outlines (`r_cel_*`) and first-person weapon outlines (`r_cel_weapon_*`); `cl_remotehitbox` is only a debug wireframe hitbox overlay.

The lowest-risk implementation is to extend the existing per-instance material styling path and add per-player mesh outlines directly on remote player meshes.

## Source Findings

### Existing Player Color Path

File: `src/engine/animation/PlayerModelManager.ts`

`PlayerModelManager.applyTeamColor(instance, team)`:

- Walks `instance.mesh` plus child meshes.
- Clones each mesh material into `teamMat_${instance.id}_${mesh.name}`.
- Sets PBR `albedoColor` to predefined HDR-ish team colors.
- Leaves the original texture in place, so texture detail is preserved and only the color multiplier changes.

Current colors (hardcoded today, not cvars):

```ts
static readonly TEAM_COLORS = {
  alpha: { r: 0.05, g: 0.9, b: 1.5 },
  bravo: { r: 1.4, g: 0.2, b: 1.2 },
};
```

This is strong evidence that arbitrary client-side player color is feasible. The main change is API shape: instead of only `"alpha" | "bravo" | null`, accept a concrete RGB color/style object.

Naming note: code currently uses `alpha` / `bravo` as render palette slots, while gameplay/team IDs seen by the client are `udon` and `soba`. The desired user-facing names are always **Team Udon** and **Team Soba**. Internally it would be cleaner to standardize on neutral slots like `ALPHA` / `BETA`, then map those slots to display names `udon` / `soba` at the UI boundary. The matchmaking UI should not expose "alpha/bravo" labels.

### Existing Remote Player Styling Entry Point

File: `src/games/fps/client/RemotePlayerRenderer.ts`

Remote player instances are created in `createModelInstance(entityId)` and immediately styled:

```ts
this.modelManager.playAnimation(instance, "idle");
this.modelManager.applyTeamColor(instance, this.resolveTeamColor(entityId));
```

`pushSnapshot()` already sees every `state.players` entry and records remote teams in `this.teams`. It also receives `localEntityId`, so it can determine the local player team by matching `player.entityId === localEntityId`.

That means local team detection is possible:

- Team modes: map remote team IDs (`udon` / `soba`) into internal team slots (`ALPHA` / `BETA`) and apply the matching team-slot visual cvars to **both teammates and enemies**. This lets players configure teammate readability too.
- FFA/no-team: every remote player can use the enemy/free-for-all fallback style.
- Demo/spectator: probably apply team-slot styling when roster team data exists; otherwise use the fallback remote-player style unless a followed player is hidden.

### Existing Outline Paths

There are two relevant outline systems.

1. `src/engine/weapon/WeaponViewManager.ts`

Weapons use Babylon's built-in inverted-hull outline:

```ts
mesh.renderOutline = this._weaponOutlineEnabled;
mesh.outlineWidth = adjustedWidth;
mesh.outlineColor = this._weaponOutlineColor;
```

`WeaponCharge.ts` also temporarily overrides those properties for a red pulsing charge outline.

This path is per-mesh, per-color, and already proven in-game. It is the best candidate for enemy player outlines.

2. `src/engine/effects/CelOutlinePostProcess.ts` and `PostProcessingManager.ts`

The cel outline system registers:

- `r_cel_outlines`
- `r_cel_thickness`
- `r_cel_depth_threshold`
- `r_cel_normal_threshold`
- `r_cel_opacity`
- `r_cel_color`

This is a global post-process using depth/normal edges. It can exclude meshes with `metadata.celOutlineExclude`, but it does not currently support include-only enemy outlines or separate colors per target. It is useful for global style, not for `enemy outline color`.

### Existing Hitbox Outline Is Not The Same Feature

`RemotePlayerRenderer` registers `cl_remotehitbox`, described as "Show wireframe hitbox outlines on remote players". This is a debug hitbox mesh, not a model silhouette/outline feature. It should remain separate.

### Existing Model Outline Cvar Check

Checked source for `renderOutline`, `outlineWidth`, `outlineColor`, `r_cel_*`, `r_cel_weapon_*`, `cl_*outline`, and player/remote outline references.

Result:

- **Global/world-ish outline:** `r_cel_outlines`, `r_cel_thickness`, `r_cel_depth_threshold`, `r_cel_normal_threshold`, `r_cel_opacity`, `r_cel_color` in `PostProcessingManager` / `CelOutlinePostProcess`.
- **First-person weapon outline:** `r_cel_weapon_outlines`, `r_cel_weapon_width`, `r_cel_weapon_color` in `PostProcessingManager`, applied by `WeaponViewManager`.
- **Debug remote hitbox:** `cl_remotehitbox` in `RemotePlayerRenderer`.
- **Missing:** no existing cvar for remote/player model silhouette outlines. This feature needs new player-model cvars and an apply path.

## Proposed User-Facing Options

Recommended cvars:

```text
cl_team_alpha_color "0.05 0.9 1.5"      # display: Team Udon by current mapping
cl_team_beta_color "1.4 0.2 1.2"        # display: Team Soba by current mapping
cl_team_alpha_outline_color "0 0 0"
cl_team_beta_outline_color "0 0 0"
cl_player_outline 1
cl_player_outline_size 25
cl_player_fullbright 0
cl_player_fullbright_intensity 0.25
cl_enemy_color "0.05 0.9 1.5"           # fallback for FFA/no-team, optional
cl_enemy_outline_color "0 0 0"          # fallback for FFA/no-team, optional
```

Notes:

- Use `cl_` prefix because these are client-only gameplay visibility preferences.
- Keep code/team-slot cvars neutral (`alpha` / `beta` or future enum names), but UI labels must be **Team Udon** and **Team Soba**.
- Store colors as strings in the same `"r g b"` format already used by `r_cel_color` and `r_cel_weapon_color`.
- Prefer one outline enable and one outline size for all player models at first. Color can vary by team slot.
- Use `cl_player_outline_size` rather than `width` if we want UI language that feels less renderer-specific. Keep the scale user-facing and familiar: `0-100`, default `25`, internally normalized for `MODEL_SCALE = 36`.
- Prefer `cl_player_fullbright_intensity` over only a boolean, even if the settings UI exposes a checkbox first. Tuning will matter.

Settings UI mapping:

- Team Udon Color: swatch/select or future color picker bound to `cl_team_alpha_color` under the current Udon->Alpha slot mapping.
- Team Soba Color: swatch/select or future color picker bound to `cl_team_beta_color` under the current Soba->Beta slot mapping.
- Team Udon Outline Color: bound to `cl_team_alpha_outline_color`.
- Team Soba Outline Color: bound to `cl_team_beta_outline_color`.
- Player Outline: toggle bound to `cl_player_outline`.
- Outline Size: slider bound to `cl_player_outline_size`.
- Fullbright: toggle bound to `cl_player_fullbright`.
- Advanced/tuning later: fullbright intensity slider, FFA/enemy fallback color controls.

## Implementation Direction

### 1. Add A Player Visual Style API

Extend `PlayerModelManager` with a richer style method instead of overloading team names forever:

```ts
interface PlayerModelVisualStyle {
  tintColor: Color3 | null;
  fullbrightEnabled: boolean;
  fullbrightIntensity: number;
  outlineEnabled: boolean;
  outlineColor: Color3;
  outlineSize: number;
}
```

Possible method:

```ts
applyVisualStyle(instance: PlayerModelInstance, style: PlayerModelVisualStyle): void
```

It can reuse the material-cloning logic from `applyTeamColor()`.

Keep `applyTeamColor()` as a compatibility wrapper:

```ts
applyTeamColor(instance, team) {
  this.applyVisualStyle(instance, { tintColor: teamColor, ...defaults });
}
```

### 2. Team Slot Colors And Enemy Fallback

Current tinting sets PBR `albedoColor`, which multiplies the model's existing texture. That is exactly what we want for configurable team/enemy colors because armor/details remain visible.

For arbitrary color:

- Parse `cl_team_alpha_color` and `cl_team_beta_color` into `Color3`.
- In team modes, apply the remote player's team-slot color whether the player is teammate or enemy. That supports configuring teammate readability too.
- In FFA/no-team, use `cl_enemy_color` or a later `cl_player_ffa_color` fallback.
- Keep user-facing names as Team Udon / Team Soba, even if the internal slot names are Alpha / Beta.

Recommended mapping cleanup:

- Server/network team IDs can remain `udon` / `soba` as gameplay concepts.
- Renderer internals can normalize to `TeamSlot.Alpha` / `TeamSlot.Beta`.
- UI should render `Team Udon` / `Team Soba` only; fix matchmaking UI places that leak alpha/beta/bravo labels.

### 3. Fullbright Without Losing Details

Avoid setting PBR `unlit = true` as the default. It would be a literal fullbright mode, but it can flatten lighting too much and may make the model look detached from the map.

Better default: additive visibility boost through emissive while keeping normal PBR lighting.

Options to test:

1. **Tinted emissive boost:**
   - Keep `albedoTexture` and `albedoColor`.
   - Set `emissiveColor = tintColor.scale(intensity)`.
   - Low intensity range: `0.15-0.4`.
   - Preserves texture and lighting best, but dark texture areas may remain fairly dark.

2. **Texture-preserving emissive boost:**
   - Set `emissiveTexture = albedoTexture` if available.
   - Set `emissiveColor` to a low neutral or tint color.
   - This keeps texture details visible in shadow, but can over-brighten or bloom if intensity is too high.

3. **True unlit/fullbright:**
   - Set PBR `unlit = true` if supported by the loaded material.
   - Strong visibility, but least desirable because it loses most environmental lighting cues.

Recommendation: implement option 1 first, maybe option 2 behind the same tickbox if browser tests show dark armor stays too dark. Do not ship true unlit unless explicitly desired.

### 4. Player Model Outline

Use Babylon's per-mesh outline properties, mirroring `WeaponViewManager`. This needs new player-model cvars; source inspection found no existing player/model outline cvar:

```ts
for (const mesh of [instance.mesh, ...instance.mesh.getChildMeshes()]) {
  mesh.renderOutline = style.outlineEnabled;
  mesh.outlineColor = style.outlineColor;
  mesh.outlineWidth = style.outlineSize;
}
```

Size should be normalized for `MODEL_SCALE = 36`, similar to weapon outlines dividing by root scale. A first guess:

```ts
const adjustedWidth = (cl_player_outline_size / 100) / MODEL_SCALE;
```

This absolutely needs browser tuning because Babylon outline width is sensitive to mesh scale and model import structure. Start with `cl_player_outline_size = 25`, matching weapon-outline scale, then tune by screenshot.

### 5. Reactive Updates

Cvar `onChange` callbacks are available, but `RemotePlayerRenderer` is instance-owned. The simplest robust approach is polling a compact style signature in `RemotePlayerRenderer.render()`:

```ts
const styleKey = `${teamSlot}|${teamColor}|${outlineColor}|${outline}|${outlineSize}|${fullbright}|${intensity}`;
if (hitbox.appliedStyleKey !== styleKey) {
  this.modelManager.applyVisualStyle(hitbox.model, style);
  hitbox.appliedStyleKey = styleKey;
}
```

This matches existing remote-player behavior where team color is re-applied when the desired team changes.


## Implementation Sketch

We can implement this with the information currently available. No new rendering research is required before a first pass. The only pieces that need browser tuning are default colors, outline size normalization, and fullbright intensity.

### File-Level Plan

Primary files:

- `src/engine/animation/PlayerModelManager.ts`
  - Owns cloned player model materials.
  - Add the reusable `PlayerModelVisualStyle` type and `applyVisualStyle()` method.
  - Keep `applyTeamColor()` as a wrapper so existing call sites continue to work during migration.
- `src/games/fps/client/RemotePlayerRenderer.ts`
  - Owns remote player instance creation and per-frame updates.
  - Register/read player visual cvars or call a small helper module that does.
  - Track local team slot from snapshots.
  - Resolve each remote model to a team/FFA style and apply only when a style signature changes.
- `src/games/fps/client/settings/FPSSettingsView.ts`
  - Add UI rows for Team Udon / Team Soba colors, outline colors, outline toggle, outline size, and fullbright toggle.
  - Existing settings helpers already support cvar sliders, toggles, and color selects/swatches.

Optional helper file if the logic starts to crowd `RemotePlayerRenderer`:

- `src/games/fps/client/PlayerModelVisualSettings.ts`
  - Color parsing.
  - Cvar registration.
  - Team ID -> visual slot mapping.
  - Style signature generation.

### Cvar Registration

Recommended first-pass cvars:

```ts
Cvar.register("cl_team_alpha_color", "0.05 0.9 1.5", {
  type: "string",
  description: 'Team Udon player color RGB ("r g b", 0-1+ HDR range)',
});

Cvar.register("cl_team_beta_color", "1.4 0.2 1.2", {
  type: "string",
  description: 'Team Soba player color RGB ("r g b", 0-1+ HDR range)',
});

Cvar.register("cl_team_alpha_outline_color", "0 0 0", {
  type: "string",
  description: 'Team Udon player outline RGB ("r g b")',
});

Cvar.register("cl_team_beta_outline_color", "0 0 0", {
  type: "string",
  description: 'Team Soba player outline RGB ("r g b")',
});

Cvar.register("cl_player_outline", 1, {
  type: "int",
  min: 0,
  max: 1,
  description: "Enable player model outlines (0/1)",
});

Cvar.register("cl_player_outline_size", 25, {
  type: "float",
  min: 0,
  max: 100,
  description: "Player outline size (0-100 scale)",
});

Cvar.register("cl_player_fullbright", 0, {
  type: "int",
  min: 0,
  max: 1,
  description: "Boost player model brightness without replacing texture detail (0/1)",
});

Cvar.register("cl_player_fullbright_intensity", 0.25, {
  type: "float",
  min: 0,
  max: 1,
  description: "Player model emissive visibility boost",
});
```

The `alpha` / `beta` names here are render/config slots. Settings and matchmaking UI must label them as Team Udon and Team Soba.

### Color Parser

Keep parsing deliberately small and shared by all cvar colors:

```ts
function parseRgbCvar(value: string, fallback: Color3): Color3 {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback.clone();
  return new Color3(
    Math.max(0, parts[0]),
    Math.max(0, parts[1]),
    Math.max(0, parts[2]),
  );
}
```

Do not clamp to 1.0 for model tint cvars because current team colors already use HDR-ish values (`b: 1.5`, `r: 1.4`) to compensate for the base texture.

### Team Slot Mapping

Add a small renderer-side mapper:

```ts
type PlayerTeamSlot = "alpha" | "beta" | "ffa";

function teamIdToSlot(teamId: string | null | undefined): PlayerTeamSlot {
  if (teamId === "udon") return "alpha";
  if (teamId === "soba") return "beta";
  return "ffa";
}
```

Longer-term cleanup: rename existing `bravo` render slot to `beta` to match the desired internal terminology. That can be a small compatibility bridge:

```ts
type LegacyTeamColor = "alpha" | "bravo";
// beta maps to legacy bravo until PlayerModelManager is cleaned up.
```

### PlayerModelManager Style API

Add a richer style type in `PlayerModelManager.ts`:

```ts
export interface PlayerModelVisualStyle {
  tintColor: Color3 | null;
  fullbrightEnabled: boolean;
  fullbrightIntensity: number;
  outlineEnabled: boolean;
  outlineColor: Color3;
  outlineSize: number;
}
```

Implementation should reuse the existing clone-per-instance behavior:

```ts
applyVisualStyle(instance: PlayerModelInstance, style: PlayerModelVisualStyle): void {
  const allMeshes = [instance.mesh, ...instance.mesh.getChildMeshes()];
  const tint = style.tintColor ?? Color3.White();
  const outlineWidth = Math.max(0, style.outlineSize / 100 / 36); // first-pass MODEL_SCALE normalization

  for (const mesh of allMeshes) {
    if (mesh.material) {
      const mat = this.ensureInstanceMaterial(instance, mesh);
      const pbr = mat as any;

      if (pbr.albedoColor) {
        pbr.albedoColor.r = tint.r;
        pbr.albedoColor.g = tint.g;
        pbr.albedoColor.b = tint.b;
      }

      if (pbr.emissiveColor) {
        if (style.fullbrightEnabled) {
          pbr.emissiveColor.r = tint.r * style.fullbrightIntensity;
          pbr.emissiveColor.g = tint.g * style.fullbrightIntensity;
          pbr.emissiveColor.b = tint.b * style.fullbrightIntensity;
        } else {
          pbr.emissiveColor.r = 0;
          pbr.emissiveColor.g = 0;
          pbr.emissiveColor.b = 0;
        }
      }
    }

    mesh.renderOutline = style.outlineEnabled;
    mesh.outlineColor = style.outlineColor;
    mesh.outlineWidth = outlineWidth;
  }
}
```

The real code should avoid hardcoding `36` inside `PlayerModelManager` if possible. Either pass normalized `outlineSize` from `RemotePlayerRenderer`, or add `outlineScaleDivisor` to the style object.

### Material Clone Helper

The current `applyTeamColor()` duplicates clone/update behavior inline. Refactor that into a helper so style updates do not repeatedly clone materials:

```ts
private ensureInstanceMaterial(instance: PlayerModelInstance, mesh: Mesh): Material | null {
  if (!mesh.material) return null;
  const cloneName = `playerMat_${instance.id}_${mesh.name}`;
  if (mesh.material.name === cloneName) return mesh.material;
  const cloned = mesh.material.clone(cloneName);
  if (!cloned) return mesh.material;
  mesh.material = cloned;
  return cloned;
}
```

Then `applyTeamColor()` can call `applyVisualStyle()` with default outline/fullbright values.

### RemotePlayerRenderer Application Flow

Extend the hitbox wrapper with cached style state:

```ts
interface RemotePlayerHitbox {
  // existing fields...
  appliedStyleKey: string | null;
}
```

Track local team slot:

```ts
private localTeamSlot: PlayerTeamSlot = "ffa";
```

In `pushSnapshot(state, localEntityId)`:

```ts
for (const player of state.players.values()) {
  if (player.team) this.teams.set(player.entityId, player.team);
  if (player.entityId === localEntityId) {
    this.localTeamSlot = teamIdToSlot(player.team);
  }
}
```

When a model exists or is updated:

```ts
private updateModelStyle(hitbox: RemotePlayerHitbox, entityId: string): void {
  if (!hitbox.model || !this.modelManager) return;

  const slot = teamIdToSlot(this.teams.get(entityId));
  const style = this.resolveVisualStyle(slot);
  const key = this.getVisualStyleKey(slot, style);

  if (hitbox.appliedStyleKey === key) return;
  this.modelManager.applyVisualStyle(hitbox.model, style);
  hitbox.appliedStyleKey = key;
}
```

Call it:

- right after model creation in `createModelInstance()` or late assignment;
- during `updateModel()` before animation work or after team-change detection;
- after any `applyTeamColor()` compatibility wrapper is removed.

### Style Resolution

First-pass behavior:

```ts
private resolveVisualStyle(slot: PlayerTeamSlot): PlayerModelVisualStyle {
  const isBeta = slot === "beta";
  const tint = parseRgbCvar(
    Cvar.getString(isBeta ? "cl_team_beta_color" : "cl_team_alpha_color"),
    isBeta ? DEFAULT_BETA_COLOR : DEFAULT_ALPHA_COLOR,
  );
  const outlineColor = parseRgbCvar(
    Cvar.getString(isBeta ? "cl_team_beta_outline_color" : "cl_team_alpha_outline_color"),
    Color3.Black(),
  );

  return {
    tintColor: tint,
    fullbrightEnabled: Cvar.getBool("cl_player_fullbright"),
    fullbrightIntensity: Cvar.getNumber("cl_player_fullbright_intensity"),
    outlineEnabled: Cvar.getBool("cl_player_outline"),
    outlineColor,
    outlineSize: Cvar.getNumber("cl_player_outline_size"),
  };
}
```

For `ffa`, either use the alpha/default enemy color for now, or add the optional `cl_enemy_color` / `cl_enemy_outline_color` fallback cvars.

### Settings UI

`FPSSettingsView` already has helpers for cvar toggles/sliders/color controls. A compact first UI pass could add this under graphics/interface:

- Team Udon Color -> `cl_team_alpha_color`
- Team Soba Color -> `cl_team_beta_color`
- Team Udon Outline -> `cl_team_alpha_outline_color`
- Team Soba Outline -> `cl_team_beta_outline_color`
- Player Outline -> `cl_player_outline`
- Outline Size -> `cl_player_outline_size`
- Player Fullbright -> `cl_player_fullbright`

Keep `cl_player_fullbright_intensity` console-only for the first pass unless we want one more slider.

### Compatibility / Migration

Current names:

- server/team IDs: `udon`, `soba`, `spectator`
- renderer palette slots: `alpha`, `bravo`
- desired internal render slots: `ALPHA`, `BETA`
- desired UI names: Team Udon, Team Soba

Recommended staged cleanup:

1. Add a `TeamSlot`/`PlayerTeamSlot` mapper in the client renderer.
2. Keep `alpha` and `bravo` compatibility in `PlayerModelManager` until no call sites pass `bravo`.
3. Rename `bravo` to `beta` in the visual style layer.
4. Audit matchmaking/settings UI for exposed alpha/bravo labels and replace with Team Udon / Team Soba.

## Do We Need More Information?

No blocker for implementation. The source already answers the important questions:

- Player material tint is feasible and already shipped.
- Player model outline does not have a cvar yet, but per-mesh outlines are proven by weapon outlines.
- Fullbright can be done as a conservative emissive boost instead of a new shader.

Information still needed only for tuning/polish:

- Final default Team Udon / Team Soba colors.
- Whether FFA should use `cl_enemy_color`, `cl_player_ffa_color`, or reuse Team Udon color.
- Whether fullbright intensity should be exposed in UI immediately or console-only for tuning.
- Browser screenshots to tune `cl_player_outline_size` against actual `MODEL_SCALE = 36`.

## Design Risks

- **Bloom/overexposure:** emissive fullbright can trigger bloom and make enemies look like pickups/projectiles. Keep intensity bounded and default conservative.
- **Outline scale:** player GLB scale is large (`MODEL_SCALE = 36`); outline width must be normalized and visually tuned.
- **Ragdolls/deathcam:** detached models may carry their enemy style into ragdolls. That might look good, but if corpse outlines are noisy, clear `renderOutline` when spawning ragdolls.
- **Spectator/demo:** followed-player hiding already hides body and weapon roots; outline state should not re-enable hidden targets.
- **Team identity:** UI labels must stay Team Udon / Team Soba. Internal `alpha` / `beta` slots are fine, but leaking alpha/bravo names into matchmaking/settings is confusing and should be fixed.
- **Material type assumptions:** current player model path appears PBR-oriented. Style code should check properties defensively (`albedoColor`, `emissiveColor`, `emissiveTexture`, `unlit`) because future models may use different material classes.

## Recommended Work Order

1. Add color parsing helper and player/team visual cvars in `RemotePlayerRenderer` or nearby client visual settings module.
2. Normalize remote team IDs (`udon` / `soba`) into internal slots (`ALPHA` / `BETA`) for rendering decisions.
3. Add `applyVisualStyle()` to `PlayerModelManager`, reusing/clustering the existing material clone logic.
4. Apply style on model creation and when the style signature changes.
5. Add per-mesh `renderOutline` handling with normalized `cl_player_outline_size`.
6. Expose settings UI controls with user-facing labels Team Udon / Team Soba: team color, team outline color, player outline, outline size, fullbright toggle.
7. Fix matchmaking/settings UI labels that leak alpha/bravo instead of Udon/Soba.
8. Browser tune defaults on a dark map and a bright map.

## Validation Plan

Headless/code:

- `npx vitest run` for any new parser/style helper tests.
- `npm run test:simulation` to ensure no gameplay sim coupling.
- `npm run build` for TypeScript and Vite.

Browser/manual:

- Team match: Team Udon and Team Soba players use their configured team-slot color/outline, including teammates.
- FFA: all remote players use fallback enemy/FFA color/outline.
- Toggle fullbright at runtime and confirm details remain visible.
- Tune outline width at `MODEL_SCALE = 36` and confirm no huge inflated hull.
- Die/respawn and confirm ragdoll/deathcam does not leave stale outlines or material state.
- Demo/spectator POV: hidden followed player remains fully hidden, including outline and weapon root.

## Conclusion

This feature is feasible with low-to-medium risk. The safest path is to extend the existing player material clone/tint system and reuse Babylon's built-in per-mesh outline path already used by weapons. There is currently no player-model outline cvar, only global cel outline and weapon outline cvars, so this work should add a player-specific cvar set. The parts that need real visual tuning are fullbright intensity and `cl_player_outline_size` normalization.