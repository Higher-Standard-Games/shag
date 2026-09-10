# Sprite System

> Verified against <code>src/engine/sprites</code> and <code>MapRenderer</code> on 2026-08-06.

Sprites are engine extensions and raw-map presentation features. They are not FPS network entities by default.

| API | Purpose |
|---|---|
| <code>SpriteSheet</code> | Frame/direction UV mapping |
| <code>BillboardSprite</code> | Animated directional billboard with optional lighting/shadow |
| <code>SpriteManager</code> | Scene/camera ownership, sheet cache, animated and static sprite factories |
| <code>SpriteBuilding</code> | Textured plane with optional trigger/collision boxes |

<code>SpriteManager</code> can also load an explicit JSON manifest containing a base path and categories of static sprite definitions. No fixed <code>sprites.json</code> path is assumed by the manager.

Raw <code>MapRenderer</code> integrations:

- <code>sprite</code> or <code>misc_sprite</code>: static image, size, scale, anchor, billboard, shadow;
- <code>sprite_building</code>: textured building plane, fixed/billboard mode, optional interaction/collision boxes;
- <code>npc_sprite</code>: directional animated sheet using <code>BillboardSprite</code>.

<code>npc_sprite</code> is a visual entity name, not a dedicated NPC AI class. It receives a default looping idle animation. Gameplay behavior must be added separately.

Initialize <code>SpriteManager</code> with the active scene and camera before creating animated sprites. Dispose individual sprites; call <code>clear()</code> for animated sprites/sheets and <code>clearCaches()</code> for static sprites and cached textures/materials during teardown. <code>SpriteManager</code> has no manager-level <code>dispose()</code>. Scene services reset sprite singletons on rebuild.

Map source origins use Quake <code>X Y Z</code> and convert to Babylon <code>X Z Y</code>.
