# HUD Data Layer — Design Document

> **Date:** 2026-02-18
> **Status:** Planning
> **Branch:** `feature/hud-data-layer`

---

## Goal

Provide a clean, lightweight, constantly-updated data source on the client that any HUD or UI component can read without touching networking or game internals directly.

---

## HUD Data Matrix

### What Exists vs What's Missing

| Category | Element | Data | Exists? | Source | Action Needed |
| -------- | ------- | ---- | ------- | ------ | ------------- |
| **Self** | Health | `number` | ❌ | — | Add to PlayerState + server |
| **Self** | Armor | `number` | ❌ | — | Add to PlayerState + server |
| **Self** | Current weapon | `string` | ✅ | `weapon_state` event | — |
| **Self** | Current ammo | `number` | ✅ | `weapon_state` event | — |
| **Self** | Weapon inventory | `string[]` | ✅ | `weapon_state` event | — |
| **Self** | All ammo | `Record<string, number>` | ✅ | `weapon_state` event | — |
| **Self** | Speed | `number` | ✅ | Local velocity | Client-side calc |
| **Score** | Player name | `string` | ⚠️ | `PlayerState.name` | Currently "Player N", use join name |
| **Score** | Frags | `number` | ✅ | `PlayerState.score` | — |
| **Score** | Deaths | `number` | ❌ | — | Add to PlayerState |
| **Score** | Ping | `number` | ⚠️ | `PlayerState.ping` | Always 0, server must populate |
| **Score** | Team | `string` | ✅ | `PlayerState.team` | — |
| **Match** | Phase | `string` | ✅ | `match_state` event | warmup/countdown/active/over |
| **Match** | Timer | `number` | ✅ | `match_state` event | — |
| **Match** | Frag limit | `number` | ❌ | — | Add to match_state |
| **Kill** | Killer name | `string` | ⚠️ | `death` event | Need name lookup from player map |
| **Kill** | Victim name | `string` | ⚠️ | `death` event | Same |
| **Kill** | Weapon used | `string` | ❌ | — | Add weaponId to death event |
| **Damage** | Hit marker | `boolean` | ✅ | `damage` event | Client checks own entity |
| **Damage** | Damage amount | `number` | ✅ | `damage` event | Already has `damage` field |
| **Damage** | Floating number pos | — | ✅ | Enemy entity position | Use victim entity position (see below) |
| **Damage** | Damage direction | `{x,y,z}` | ❌ | — | Add attacker pos to damage event |

---

## Floating Damage Numbers

QuakeLive and Warfork show damage amount floating above the hit player's head. Two approaches:

### Option A: Use victim entity position (Recommended)

The client already knows every player's interpolated position. When a `damage` event arrives with `entityId`, look up that entity's current render position and spawn the number above their head.

- **Pro:** Zero extra network data
- **Pro:** Draws at the right 3D position even during movement
- **Pro:** Works with interpolation — number appears at the smooth visual position
- **Con:** If damage event arrives late (1-2 ticks), position is slightly behind

### Option B: Send hit position in damage event

Include the exact hit coordinates (`hitX, hitY, hitZ`) in the damage event.

- **Pro:** Pixel-perfect — number appears exactly where the shot landed
- **Con:** Extra 12 bytes per damage event (3 floats)
- **Con:** Position is from 1-2 ticks ago (server time), looks stale since client has moved

**Verdict: Option A.** Use the victim entity's current client-side position. It's free, smooth, and what Q3/Warsow do. The slight delay is imperceptible because damage events arrive within 1-2 ticks anyway.

### Data flow

```text
Server: damage event → { type: 'damage', entityId, attackerId, damage, weaponId }
Client: receives event
  → is attackerId == my entityId? (I caused this damage)
    → look up entityId position in entity map
    → spawn floating "+42" at position + headOffset
  → is entityId == my entityId? (I took damage)
    → flash screen red
    → show damage direction indicator (using attackerId position)
```

> [!NOTE]
> The `attackerId` field is currently missing from damage events. Need to add it so both hit confirmation AND damage direction work.

---

## Client-Side Data Access: HUDState

All HUD data should live in a single lightweight object that's updated each frame. HUD/UI components just read properties — no callbacks, no events, no pub/sub complexity.

```typescript
/**
 * Lightweight reactive state for HUD — updated every frame from GameState.
 * UI components read from this directly. No callbacks necessary.
 */
interface HUDState {
  // ── Self ──────────────────────────────────────────────
  health: number;          // 0-200 (100 base + megahealth)
  armor: number;           // 0-200
  currentWeapon: string;   // 'rlauncher', 'railgun', etc.
  currentAmmo: number;     // ammo for current weapon
  weapons: string[];       // inventory: ['gunblade', 'rlauncher']
  ammo: Record<string, number>;  // { rlauncher: 15, railgun: 10, ... }
  speed: number;           // horizontal speed (units/sec)

  // ── Match ─────────────────────────────────────────────
  matchPhase: string;      // 'warmup' | 'countdown' | 'active' | 'over'
  matchTimer: number;      // seconds remaining
  fragLimit: number;       // 0 = no limit

  // ── Scoreboard ────────────────────────────────────────
  players: ScoreboardEntry[];  // sorted by score desc

  // ── Transient (auto-expire) ───────────────────────────
  killFeed: KillFeedEntry[];     // last ~5 kills, with timestamps
  damageNumbers: DamageFloat[];  // active floating numbers (world space)
  damageDirection: number | null; // angle to last attacker (radians, 0=front)
}

interface ScoreboardEntry {
  name: string;
  score: number;
  deaths: number;
  ping: number;
  team: string;
  isLocal: boolean;  // highlight own row
}

interface KillFeedEntry {
  killer: string;    // player name
  victim: string;
  weapon: string;    // weapon icon/id
  timestamp: number; // for auto-remove after ~5s
}

interface DamageFloat {
  amount: number;    // damage dealt
  worldPos: { x: number; y: number; z: number };  // 3D position
  spawnTime: number; // for fade/float animation
}
```

### Update Strategy

```text
Every frame (rAF):
  1. Read latest GameState snapshot
  2. Process events → update HUDState transients (kill feed, damage numbers)
  3. Copy persistent fields (health, armor, weapon, match state)
  4. Expire old transients (kill feed > 5s, damage floats > 1s)
  5. UI components read HUDState properties directly
```

This is essentially a **pull model** — the HUD reads state each frame. No event subscriptions, no callbacks, no race conditions. The `HUDState` object is a plain object that's cheap to update.

---

## Server-Side Changes Required

### PlayerState additions

```diff
 PlayerState {
   entityId, name, team, score, ping,
+  deaths: number,
+  health: number,
+  armor: number,
 }
```

Serialization: add 3 fields → `writeUint16(health)`, `writeUint16(armor)`, `writeUint16(deaths)`.
Cost: +6 bytes per player per snapshot (negligible with delta compression).

### Event enrichments

```diff
 damage event:
-  { type: 'damage', entityId, damage }
+  { type: 'damage', entityId, attackerId, damage, weaponId }

 death event:
-  { type: 'death', entityId, killerId }
+  { type: 'death', entityId, killerId, weaponId }
```

### Other server changes

- Write `client.connection.latency` → `PlayerState.ping`
- Write join message `playerName` → `PlayerState.name` (instead of "Player N")
- Add frag limit to `match_state` event
- Track deaths in gametype controller

---

## Implementation Phases

### Phase 1: Data plumbing (no visuals)

Add missing fields to PlayerState, enrich events, populate ping and names. Client receives everything but doesn't display it yet.

### Phase 2: HUDState aggregator

Client-side `HUDState` class that reads GameState each frame and exposes a clean API. This becomes the single source of truth for all UI.

### Phase 3: Health/armor gameplay

Actually implement the health system, damage reduction from armor, respawn logic. This is gameplay code, not networking.

### Phase 4: HUD rendering (separate task)

Build the actual HUD UI using `HUDState` as the data source. This doc doesn't cover rendering — that's a follow-up.
