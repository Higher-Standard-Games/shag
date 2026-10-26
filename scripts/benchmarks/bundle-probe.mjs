/** Diagnostic only. Self-contained so the driver can install it in its owned page. */
export function installBundleProbe(engine, scene) {
  if (
    !engine.isWebGPU ||
    engine.compatibilityMode !== false ||
    engine._snapshotRendering?.play ||
    engine._snapshotRendering?.record
  )
    throw new Error("Bundle probe requires ordinary WebGPU non-compatibility rendering");
  if (!engine._currentDrawContext) throw new Error("Unsupported Babylon draw context");
  const drawPrototype = Object.getPrototypeOf(engine._currentDrawContext);
  if (
    typeof engine._draw !== "function" ||
    ["isDirty", "setBuffer", "reset"].some((key) => typeof drawPrototype[key] !== "function") ||
    !engine._counters
  )
    throw new Error("Unsupported Babylon draw context");
  let meshPrototype = scene.meshes.find((mesh) => typeof mesh._draw === "function");
  while (meshPrototype && !Object.hasOwn(meshPrototype, "_draw")) meshPrototype = Object.getPrototypeOf(meshPrototype);
  if (!meshPrototype) throw new Error("No mesh draw hook");
  const restores = [];
  let pending = new WeakMap(),
    seen = new WeakSet();
  let owner = null,
    invocation = null,
    phase = null,
    disposed = false;
  const change = (context) => {
    let entry = pending.get(context);
    if (!entry) {
      entry = { buffers: new Set(), resets: 0 };
      pending.set(context, entry);
    }
    return entry;
  };
  const wrap = (target, key, factory) => {
    const own = Object.hasOwn(target, key),
      original = target[key],
      replacement = factory(original);
    if (typeof original !== "function") throw new Error(`Missing probe method ${key}`);
    target[key] = replacement;
    restores.push(() => {
      if (target[key] === replacement) {
        if (own) target[key] = original;
        else delete target[key];
      }
    });
  };
  const increment = (table, name) => {
    table[name] = (table[name] ?? 0) + 1;
  };
  const identity = (value) => value?.uniqueId ?? null;
  const sampleGate = (context, material) => ({
    hadBundle: !!context.fastBundle,
    firstObserved: !seen.has(context),
    drawDirty: !!context._isDirty,
    materialVersionChanged: context._materialContextUpdateId !== material.updateId,
    materialDirty: !!material.isDirty,
    externalTexture: !!material.forceBindGroupCreation,
  });
  wrap(
    drawPrototype,
    "setBuffer",
    (original) =>
      function (name, buffer) {
        if (
          phase &&
          this._bufferManager === engine._bufferManager &&
          identity(this.buffers?.[name]) !== identity(buffer)
        )
          change(this).buffers.add(name);
        return original.apply(this, arguments);
      },
  );
  wrap(
    drawPrototype,
    "reset",
    (original) =>
      function () {
        if (phase && this._bufferManager === engine._bufferManager) change(this).resets++;
        return original.apply(this, arguments);
      },
  );
  wrap(
    drawPrototype,
    "isDirty",
    (original) =>
      function (updateId) {
        // The first query inside engine._draw is the actual cache gate, after UBO binding.
        if (phase && invocation && !invocation.gate && this === engine._currentDrawContext)
          invocation.gate = sampleGate(this, engine._currentMaterialContext);
        return original.apply(this, arguments);
      },
  );
  wrap(
    meshPrototype,
    "_draw",
    (original) =>
      function (subMesh) {
        const previous = owner;
        owner =
          this.getScene() === scene
            ? { mesh: this.name, material: subMesh.getMaterial()?.name ?? "none", subMesh: subMesh._id }
            : null;
        try {
          return original.apply(this, arguments);
        } finally {
          owner = previous;
        }
      },
  );
  wrap(
    engine,
    "_draw",
    (original) =>
      function () {
        if (!phase || disposed) return original.apply(this, arguments);
        const previous = invocation;
        const context = engine._currentDrawContext;
        const event = { owner, gate: null };
        invocation = event;
        const beforeCreation = engine._counters.numBundleCreationNonCompatMode;
        const beforeReuse = engine._counters.numBundleReuseNonCompatMode;
        try {
          return original.apply(this, arguments);
        } finally {
          invocation = previous;
          const created = engine._counters.numBundleCreationNonCompatMode - beforeCreation;
          const reused = engine._counters.numBundleReuseNonCompatMode - beforeReuse;
          const camera = scene.activeCamera?.name ?? "none";
          const pass = engine.currentRenderPassId;
          const target = engine._currentRenderTarget ? "render-target" : "main";
          const key = JSON.stringify([
            camera,
            pass,
            target,
            event.owner?.mesh ?? "unmapped",
            event.owner?.material ?? "unmapped",
          ]);
          let row = phase.rows.get(key);
          if (!row && phase.rows.size >= 2000) {
            phase.overflow++;
          } else {
            if (!row) {
              row = {
                camera,
                pass,
                target,
                ...event.owner,
                draws: 0,
                created: 0,
                reused: 0,
                other: 0,
                causes: {},
                bufferChanges: {},
              };
              phase.rows.set(key, row);
            }
            row.draws++;
            row.created += created;
            row.reused += reused;
            if (!created && !reused) row.other++;
            if (created) {
              if (event.gate) {
                if (!event.gate.hadBundle)
                  increment(
                    row.causes,
                    event.gate.firstObserved ? "first-observed-empty" : "previously-observed-empty",
                  );
                for (const cause of ["drawDirty", "materialVersionChanged", "materialDirty", "externalTexture"])
                  if (event.gate[cause]) increment(row.causes, cause);
                if (
                  event.gate.hadBundle &&
                  !event.gate.drawDirty &&
                  !event.gate.materialVersionChanged &&
                  !event.gate.materialDirty &&
                  !event.gate.externalTexture
                )
                  increment(row.causes, "unexplained-gate");
              } else increment(row.causes, "gate-not-observed");
              const changes = pending.get(context);
              if (changes?.resets) increment(row.causes, "context-reset-observed");
              for (const name of changes?.buffers ?? []) increment(row.bufferChanges, name);
            }
          }
          phase.draws++;
          phase.created += created;
          phase.reused += reused;
          if (!created && !reused) phase.other++;
          pending.delete(context);
          seen.add(context);
        }
      },
  );
  return {
    begin(label) {
      if (disposed || phase) throw new Error("Probe disposed or capture already active");
      pending = new WeakMap();
      seen = new WeakSet();
      phase = { label, draws: 0, created: 0, reused: 0, other: 0, overflow: 0, rows: new Map() };
    },
    finish() {
      if (!phase) throw new Error("No active bundle capture");
      const result = { ...phase, rows: [...phase.rows.values()].sort((a, b) => b.created - a.created) };
      phase = null;
      return result;
    },
    dispose() {
      disposed = true;
      phase = null;
      for (const restore of restores.reverse()) restore();
    },
  };
}
