# Server-Authoritative Item Pickups (B) — Implementation Spec

**Date:** 2026-05-31
**Branch:** `feature/0.9.16-qa-leak-hygiene`
**Risk:** NET + protocol (golden jewel). Server+client ship in lockstep.
**Goal:** Replace the event-driven, client-timer pickup model with **convergent
state replication** so item availability can never desync ("ghost weapons").

---

## Why (the bug)

Static map weapon pickups are not snapshot entities — they live only in the
server's `PickupSystem.pickups[]` and the client's `FPSPickup` instances. Today
the only server→client signal is a one-shot `item_pickup` (deactivation) event;
the client **guesses respawn with a local 30s `setTimeout`** while the server
respawns at **25s**, and re-pickups during the client's hidden window are
dropped. Result: the client shows an item the server considers inactive →
visible but not pickable, until the server's next respawn re-aligns.

Root flaw: **persistent, user-visible state was built on lossy one-shot events.**
Events are right for transient one-shots (shot fired, explosion); persistent
state (item availability, like health/position) must be **replicated as state**
so a dropped datagram self-heals on the next snapshot.

## What (the model)

1. **Authoritative pickup ids (Step 1).** A single shared extractor produces the
   ordered weapon-pickup list with stable ids from `bsp.entities`. Both server
   and client call it on the same BSP → **identical ids on both sides**, with no
   network table message and no fragile parallel counters.
2. **Active-set in every snapshot (Step 2).** The server writes a small
   active-pickup bitmask (bit index = pickup id) into each snapshot. The client
   reconciles its `FPSPickup`s to the mask every tick (idempotent). Self-healing
   against packet loss; no events, no timers, no position matching.

The pickup count per map is ~5–15, so a full (non-delta) bitmask is 2–4 bytes —
negligible at 60 Hz. Always-send (not delta) keeps it dead simple and convergent.

---

## Step 1 — shared `extractWeaponPickups`

**New shared module** `src/shared/bsp/PickupTable.ts` (or extend `BspDataLoader`):

```ts
export interface WeaponPickupEntry {
  id: number;          // stable index in BSP order, authoritative on both sides
  classname: string;   // e.g. "weapon_rocketlauncher"
  weaponId: string;    // e.g. "rlauncher"
  position: { x: number; y: number; z: number }; // Babylon coords (Q3 Y↔Z swapped)
}

export function extractWeaponPickups(
  entities: Array<{ classname: string; properties: Record<string, string> }>,
): WeaponPickupEntry[];
```

- Single source for classname→weaponId. Prefer resolving via `EntityRegistry`
  (already shared) so it can't drift from the client's weapon defs; fall back to
  a centralized `CLASSNAME_TO_WEAPON` if the registry isn't loaded.
- `id` = sequential index over weapon entities in `bsp.entities` order.

**Server** ([PickupSystem.ts](../../src/games/fps/server/systems/PickupSystem.ts)):
- `setPickupItems` consumes `WeaponPickupEntry[]` (id from the shared list, not a
  local counter). Delete the local `CLASSNAME_TO_WEAPON`.
- `GameServer`/`headless-netserver-v2` build it via `extractWeaponPickups`.

**Client** ([EntityManager.ts](../../src/engine/entities/EntityManager.ts)):
- At map load ([MapLoader.processBspEntities](../../src/engine/loader/map/MapLoader.ts#L742)),
  compute the shared table once and hand it to `EntityManager`
  (`setPickupTable(...)`).
- In `spawnEntity`, assign each weapon `FPSPickup` its authoritative `id` by
  matching classname + origin against the table (exact — same BSP strings).
  Delete `nextPickupId`.

**Result:** `FPSPickup.pickupById` is keyed by ids that exactly match the server.

## Step 2 — active-set replication

**Wire** ([BinaryProtocol.ts](../../src/engine/network/protocol/BinaryProtocol.ts)):
- In `encodeSnapshot`, after events, write the pickup active-set:
  `writeUint16(pickupCount)` then `ceil(pickupCount/8)` mask bytes (bit i = pickup id i active). Always full (not delta) for convergence.
- `decodeSnapshot` reads it into `GameState.pickupActiveMask: boolean[]` (or `Uint8Array`).
- Backward/forward note: additive section → bump the snapshot/protocol version
  constant; client+server lockstep. Old demos won't carry it (decoder treats
  absent as "all active" / skips when version < N).

**Server** ([PickupSystem.ts](../../src/games/fps/server/systems/PickupSystem.ts) →
[SnapshotBuilder.ts](../../src/games/fps/server/SnapshotBuilder.ts)):
- `PickupSystem.getActiveMask(): boolean[]` (indexed by id).
- `SnapshotBuilder` sets `gameState.pickupActiveMask`.
- Keep the silent respawn flip; **no respawn event needed** — the mask carries it.

**Client reconciler** (new small system or in [GameEvents.ts](../../src/games/fps/client/GameEvents.ts)):
- Each snapshot: for each id, `FPSPickup.pickupById.get(id)?.setActiveState(mask[id])`.
- `FPSPickup`/`Pickup` gains `setActiveState(active)`: idempotent show/hide
  (re-enable mesh+glow / disable mesh+glow). Reuses `respawn()`/`onPickedUp()`
  visual bodies refactored to be event-free (no sound spam on reconcile — play
  pickup sfx only on the local player's own inventory change, which already
  comes from `weapon_state`).

## Deletions (the payoff)

Once the mask is authoritative, remove:
- Client local respawn `setTimeout` ([Pickup.ts:389-394](../../src/engine/world/Pickup.ts#L389)) — and the `respawnTime: 30` in [EntityManager.ts:146](../../src/engine/entities/EntityManager.ts#L146).
- `FPSPickup.deactivateById`/`deactivateByPosition`/`checkDeferredDeactivation`/
  `pendingDeactivations` + weapon-id/position fuzzy matching ([FPSPickup.ts](../../src/games/fps/world/FPSPickup.ts)).
- The `item_pickup` static-pickup handler in [GameEvents.ts:192](../../src/games/fps/client/GameEvents.ts#L192).
- Server `item_pickup` emission for static pickups + the `getInactivePickups`
  join-sync ([SnapshotBuilder.ts:410-429](../../src/games/fps/server/SnapshotBuilder.ts#L410))
  — the mask covers join state automatically.

(`item_pickup` may be retired entirely: dropped weapons replicate as
`EntityType.Item` entities; local pickup feedback/toast comes from `weapon_state`.)

## Extras folded in (per decision)

- **Respawn-time mismatch** — with the client timer gone, the server's 25s is the
  sole authority. Centralize the value server-side; delete the client 30s.
- **Bots** ([BotGameState.ts:337](../../src/bot/BotGameState.ts#L337)) — consume
  `pickupActiveMask` for exact item availability instead of estimating from
  `itemPickupTimes`.

## Edge cases / ordering

- **Table vs map-load vs first snapshot:** Step 1 needs the table before ids are
  assigned — both come from the same local BSP at map load, so no race (no
  network dependency). The mask reconcile no-ops for ids not yet in
  `pickupById` (pickup still loading) and corrects on the next snapshot.
- **PVS:** the active-set is global (not entity-filtered); write it unconditionally
  ([events are already copied to all clients](../../src/games/fps/server/SnapshotBroadcaster.ts#L126)).
- **Packet loss:** next received snapshot re-asserts the full mask → converges.
- **Sound:** reconcile must be silent; only `weapon_state`-driven local feedback plays sfx.

## Testing

- Unit: `extractWeaponPickups` determinism (same entities → same ids; client ==
  server). Bitmask encode/decode round-trip. `setActiveState` idempotency.
- Headless: server-tick test — pick up item, advance 25s of ticks, assert mask
  bit flips back; assert no `item_pickup`-dependence.
- Manual: connect, grab RL, confirm in-sync disappear/reappear; join mid-match.
- Regression: `npm test`, `test:simulation`, `server:tick`, `server:fuzz`.
  (`test:physics` needs the gitignored `wdm7` asset — flag for the human env.)

## Rollout

Two independently shippable, testable steps. Bump the snapshot/protocol version
when Step 2 lands. Demos recorded after the bump replay only on ≥ that version.
