# Raw-map Prefabs

> Verified against <code>PrefabLoader</code>, <code>PrefabInstance</code>, and <code>SpawnValidator</code> on 2026-08-06.

Prefabs are raw <code>.map</code> fragments used by the extension rendering path. They are not PK3 BSP submodels and are not part of normal FPS map loading.

<code>PrefabLoader</code> fetches and caches parsed maps. Its default base is <code>GamePaths.prefabs()</code>; <code>setBasePath()</code> can override it. Names gain a <code>.map</code> suffix when omitted.

<code>PrefabInstance.create()</code> builds brushes and patches under one <code>TransformNode</code>. Options include Babylon position, Y rotation in degrees, uniform scale, drop-to-ground, drop offset, and collision. Drop-to-ground raycasts against pickable collision meshes and ignores existing prefab roots.

<code>createMultiple()</code> preloads once but creates instances sequentially; it is not Babylon thin instancing.

In <code>MapRenderer</code>, <code>misc_model</code> loads GLB/glTF/OBJ through <code>ModelLoader</code>. Other model paths are treated as raw-map prefabs.

<code>SpawnValidator</code> is a separate opt-in rule service. Its default global collision validator checks distance from existing prefab meshes. Named resource-cost and max-count validators are examples. <code>PrefabInstance.create()</code> does not invoke validation automatically; caller code must call it.

Convention: author the prefab floor/anchor around source origin. Quake Z-up data is converted to Babylon Y-up while meshes are generated.

See [Raw .map Format](./MAP_FORMAT.md) and [Game Paths](./GAME_PATHS.md).
