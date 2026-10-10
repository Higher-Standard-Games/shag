/** Self-contained so the profiling runner can install it in its owned CDP page. */
export function installReadinessProbe(engine, readProgress, limit = 10000) {
  const registrations = [], checks = [], pendingEvents = [], activePending = new Map();
  const labels = new WeakMap(), restores = [];
  let nextScene = 0, dropped = 0;
  const droppedByKind = { registrations: 0, checks: 0, pendingEvents: 0, activePending: 0 };
  const progress = () => { try { return readProgress(); } catch { return 'unavailable'; } };
  const label = scene => {
    if (!labels.has(scene)) labels.set(scene, `scene-${++nextScene}`);
    return labels.get(scene);
  };
  const state = scene => ({ atMs: performance.now(), progress: progress(), scene: label(scene),
    meshes: scene.meshes.length, pendingData: scene.getWaitingItemsCount(),
    readyObservers: scene.onReadyObservable.observers.length });
  const append = (list, value) => {
    if (list.length < limit) list.push(value);
    else {
      dropped++;
      droppedByKind[list === registrations ? 'registrations' : list === checks ? 'checks' : 'pendingEvents']++;
    }
  };
  const describe = data => ({ class: data?.constructor?.name ?? typeof data,
    name: typeof data?.name === 'string' ? data.name.slice(0, 256) : null });
  const wrap = (name, create) => {
    let owner = Object.getPrototypeOf(engine.scenes[0]);
    while (owner && !Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
    const descriptor = owner && Object.getOwnPropertyDescriptor(owner, name);
    if (!descriptor || typeof descriptor.value !== 'function') throw new Error(`Missing Scene.${name}`);
    const replacement = create(descriptor.value);
    Object.defineProperty(owner, name, { ...descriptor, value: replacement });
    restores.push(() => {
      if (owner[name] === replacement) Object.defineProperty(owner, name, descriptor);
    });
  };
  try {
    wrap('executeWhenReady', original => function (...args) {
      append(registrations, { ...state(this), checkRenderTargets: args[1] ?? false,
        stack: new Error('Readiness registration').stack });
      // Pass the original callback unchanged, including its identity.
      return original.apply(this, args);
    });
    wrap('isReady', original => function (...args) {
      const record = { ...state(this), stack: new Error('Readiness check').stack };
      const started = performance.now();
      try { record.ready = original.apply(this, args); return record.ready; }
      finally { record.durationMs = performance.now() - started; append(checks, record); }
    });
    wrap('addPendingData', original => function (...args) {
      const result = original.apply(this, args);
      const record = { ...state(this), kind: 'add', ...describe(args[0]),
        stack: new Error('Pending data added').stack };
      if (activePending.size < limit) {
        const previous = activePending.get(args[0]);
        activePending.set(args[0], { ...record, count: (previous?.count ?? 0) + 1 });
      } else { dropped++; droppedByKind.activePending++; }
      append(pendingEvents, record);
      return result;
    });
    wrap('removePendingData', original => function (...args) {
      const result = original.apply(this, args);
      const added = activePending.get(args[0]);
      if (added?.count > 1) added.count--; else activePending.delete(args[0]);
      append(pendingEvents, { ...state(this), kind: 'remove', ...describe(args[0]),
        observedLifetimeMs: added ? performance.now() - added.atMs : null });
      return result;
    });
  } catch (error) { for (const restore of restores.reverse()) restore(); throw error; }
  return {
    snapshot() {
      return { registrations, checks, pendingEvents, activePending: [...activePending.values()], dropped,
        limitPerKind: limit, droppedByKind: { ...droppedByKind },
        scenes: engine.scenes.map(scene => ({ ...state(scene),
          cameras: scene.cameras.map(camera => camera.name),
          readinessTimeoutMs: scene.onReadyTimeoutDuration })),
        limitations: ['Opt-in method wrappers and stack capture add diagnostic overhead.',
          'Pending entries registered before installation are not individually tracked.',
          'Scene readiness checks prepare effects; this probe does not initiate extra checks.'] };
    },
    restore() { for (const restore of restores.reverse()) restore(); activePending.clear(); },
  };
}
