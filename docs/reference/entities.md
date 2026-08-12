# Entity Reference

> Verified against the current BSP and raw-map loaders on 2026-08-06.

There are two entity paths; support in one does not imply support in the other.

## FPS BSP Path

<code>MapLoader</code> loads compiled BSPs. Current gameplay handling includes:

- player starts such as <code>info_player_start</code> and <code>info_player_deathmatch</code>;
- weapon, ammo, health, armor, and powerup classnames registered from shared entity definitions;
- <code>func_door</code> through <code>BspEntityHandlers</code>;
- teleporters and jumppads through shared <code>TriggerTable</code>;
- gametype entities such as Search & Destroy bomb sites through shared BSP tables;
- worldspawn, lighting, sky, fog, and area-light data consumed by BSP rendering systems.

Unknown non-info entities warn unless a handler is registered.

## Raw .map Extension Path

<code>MapRenderer</code> additionally recognizes presentation/extension entities including <code>worldspawn</code>, <code>light</code>, <code>misc_model</code>, <code>sprite</code>/<code>misc_sprite</code>, <code>sprite_building</code>, <code>npc_sprite</code>, and <code>info_debris_zone</code>.

These are not automatically part of compiled FPS BSP gameplay.

## Custom Handlers

Register game-owned types before loading:

    EntityHandlerRegistry.register(classname, async (entity, scene) => {
      return { handled: true };
    });

The registry also supports pre-render and post-render hooks. Owners must unregister or clear test registrations when their lifetime ends.

Quake origins convert as <code>X Y Z -> X Z Y</code>. Prefer the raw entity classname for deterministic pickup matching because aliases may share one definition.

Use <code>bsp entities</code> to inspect the actual entities in a loaded map.
