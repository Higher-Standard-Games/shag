/** Diagnostic only: count body and outline engine draw submissions. */
export function installOutlineProbe(engine, OutlineRenderer, readContext, limit = 30000) {
  const frames = [], meshes = new Map(), restores = [], stack = [];
  let frame = null, dropped = 0, meshDrawHookInstalled = false;
  const context = () => { try { return readContext() ?? {}; } catch { return {}; } };
  const wrap = (owner, name, create) => {
    const own = Object.getOwnPropertyDescriptor(owner, name), original = owner[name];
    if (typeof original !== 'function') throw new Error(`Missing outline diagnostic method ${name}`);
    const replacement = create(original);
    Object.defineProperty(owner, name, { configurable: true, writable: true, ...own, value: replacement });
    restores.push(() => {
      if (owner[name] !== replacement) return;
      if (own) Object.defineProperty(owner, name, own); else delete owner[name];
    });
  };
  const ensureFrame = () => {
    if (frame?.frameId === engine.frameId) return frame;
    const c = context();
    frame = { frameId: engine.frameId, progress: c.progress, phase: c.phase, seconds: c.seconds,
      totalDraws: 0, bodyDraws: 0, outlineCalls: 0, outlineDraws: 0, outlineCpuMs: 0, passes: {} };
    if (frames.length < limit) frames.push(frame); else dropped++;
    return frame;
  };
  const isBody = mesh => /^(player_\d+|tp_ghost_\d+)\//.test(mesh?.name ?? '') && !!mesh?.skeleton;
  try {
    wrap(OutlineRenderer.prototype, 'render', original => function (...args) {
      if (this.scene?.getEngine() !== engine) return original.apply(this, args);
      const mesh = args[0]?.getRenderingMesh(), scene = this.scene;
      const overlay = args[2] === true;
      const kind = engine.getColorWrite()
        ? (overlay ? 'overlay' : 'outline-color') : (overlay ? 'stencil' : 'outline-depth');
      const body = isBody(mesh);
      const camera = scene.activeCamera?.name ?? 'none';
      const key = `${body ? 'player-body' : 'other'}:${kind}:${camera}`;
      const current = ensureFrame(), started = performance.now();
      current.outlineCalls++;
      const pass = current.passes[key] ??= { calls: 0, draws: 0, cpuMs: 0, elements: 0 };
      pass.calls++;
      const draw = { current, pass, mesh, key, outline: true, body };
      stack.push(draw);
      try { return original.apply(this, args); }
      finally {
        stack.pop();
        const ms = performance.now() - started;
        pass.cpuMs += ms; current.outlineCpuMs += ms;
      }
    });
    const installMeshDraw = () => {
      if (meshDrawHookInstalled) return;
      const mesh = engine.scenes.flatMap(scene => scene.meshes).find(mesh => typeof mesh._draw === 'function');
      if (!mesh) return;
      let owner = Object.getPrototypeOf(mesh);
      while (owner && !Object.hasOwn(owner, '_draw')) owner = Object.getPrototypeOf(owner);
      if (!owner) return;
      wrap(owner, '_draw', original => function (...args) {
        if (stack.length || this.getScene()?.getEngine() !== engine || !isBody(this)) return original.apply(this, args);
        const current = ensureFrame(), scene = this.getScene();
        const alpha = args[0]?.getMaterial()?.needAlphaBlendingForMesh(this);
        const kind = !engine.getColorWrite() ? 'body-depth' : alpha ? 'body-alpha' : 'body-color';
        const key = `player-body:${kind}:${scene.activeCamera?.name ?? 'none'}`;
        const pass = current.passes[key] ??= { calls: 0, draws: 0, cpuMs: null, elements: 0 };
        pass.calls++;
        stack.push({ current, pass, mesh: this, key, outline: false, body: true });
        try { return original.apply(this, args); } finally { stack.pop(); }
      });
      meshDrawHookInstalled = true;
    };
    installMeshDraw();
    const observer = engine.onBeginFrameObservable.add(installMeshDraw);
    restores.push(() => engine.onBeginFrameObservable.remove(observer));
    for (const name of ['drawElementsType', 'drawArraysType']) wrap(engine, name, original => function (...args) {
      // Count returned engine draw submissions, not readiness attempts. Babylon
      // may service these from a render bundle; this is not a driver draw census.
      const result = original.apply(this, args);
      const current = ensureFrame(); current.totalDraws++;
      const active = stack.at(-1);
      if (active) {
        if (active.outline) active.current.outlineDraws++;
        else if (active.body) active.current.bodyDraws++;
        active.pass.draws++;
        active.pass.elements += (args[2] ?? 0) * Math.max(1, args[3] ?? 1);
        const id = `${active.mesh?.uniqueId}:${active.key}`;
        let entry = meshes.get(id);
        if (!entry && meshes.size < 4000) {
          entry = { name: active.mesh?.name, uniqueId: active.mesh?.uniqueId, pass: active.key,
            vertices: active.mesh?.getTotalVertices?.() ?? null, draws: 0 };
          meshes.set(id, entry);
        }
        if (entry) entry.draws++;
      }
      return result;
    });
  } catch (error) { for (const restore of restores.reverse()) restore(); throw error; }
  return {
    snapshot: () => ({ frames, meshes: [...meshes.values()], dropped, limit, meshDrawHookInstalled,
      scope: 'Engine drawElementsType/drawArraysType submissions for ordinary player/ghost Mesh._draw and OutlineRenderer.render; colour/depth/stencil/overlay separated by write state. Readiness-only calls contribute no draws.',
      limitations: ['Wrappers and CPU clocks add overhead; use separate timing-only captures for comparisons.',
        'Player-body classification uses Babylon cloned player/ghost names plus skeleton presence; inspect mesh inventory.',
        'Counts span all scene cameras/passes in the engine frame; they are not GPU invocation or driver-command counts.',
        'CPU duration includes outline readiness/binding/submission and wrappers, excluding pre/post stage state changes and GPU time.',
        'Mesh inventory is capped at 4000 entries; frame pass totals still count submissions beyond that inventory cap.'] }),
    restore() { for (const restore of restores.reverse()) restore(); stack.length = 0; },
  };
}
