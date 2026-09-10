# BuildableSystem

> Verified against <code>src/engine/BuildableSystem.ts</code> on 2026-08-06.

This is a generic engine extension used by <code>EngineScene</code> and external SHAG games. It is not FPS building gameplay and does not render or charge resources by itself.

Games register <code>BuildableTemplate</code> objects containing build time, visual progress stages, optional category/cost/level metadata, and behaviors:

- producer and consumer;
- decay phases;
- lifecycle trigger names;
- upgrade target/cost/time;
- light metadata;
- parent/child container rules.

The game injects a time provider, a visual-stage callback, and a trigger callback. <code>update()</code> advances construction, consumption, decay, production, damage, and upgrades. <code>EngineScene</code> calls it from its update loop; direct users must do the same.

Core API includes template registration/query; create/destroy/query instances; child management; resource add/collect; upgrade start; <code>serialize()</code>/<code>deserialize()</code>; and map/all-state clearing.

Subscribe with one callback:

    const listener = event => handleBuildableEvent(event);
    system.on(listener);
    system.off(listener);

Events include created, progress, stage/phase change, complete, child changes, light changes, resource warnings, production, collection, damage, destruction, and upgrades. Each is also emitted as <code>buildable:&lt;type&gt;</code> through <code>EventBus</code>.

Serialization returns instance state only. Templates, callbacks, timers, visual nodes, and game resource rules must be restored by the owner. Validate stage ranges and behavior arrays when registering templates; the system does not provide a schema loader.
