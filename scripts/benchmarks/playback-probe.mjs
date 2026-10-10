/** Opt-in diagnostics; preserves DemoViewer's delta, delivery policy and return. */
export function installPlaybackProbe(Viewer, readContext, limit = 1000) {
  const owner = Viewer.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(owner, 'update');
  if (!descriptor || typeof descriptor.value !== 'function') throw new Error('Missing DemoViewer.update');
  const events = [], previous = new WeakMap();
  let dropped = 0;
  const info = viewer => {
    try {
      const value = viewer.getInfo();
      return { state: value.state, skippedFrames: value.skippedFrames,
        playheadTick: value.playheadTick, elapsedMs: value.elapsedMs, currentFrame: value.currentFrame };
    } catch { return null; }
  };
  const context = () => { try { return readContext(); } catch { return null; } };
  const replacement = function (...args) {
    const firstUpdate = !previous.has(this);
    const before = info(this), atMs = performance.now();
    let failed = true;
    try { const result = descriptor.value.apply(this, args); failed = false; return result; }
    finally {
      const endAtMs = performance.now(), after = info(this);
      const record = { atMs, endAtMs, durationMs: endAtMs - atMs, inputDeltaMs: args[0], before, after };
      const skipped = before && after ? after.skippedFrames - before.skippedFrames : null;
      if (firstUpdate || failed || skipped > 0 || args[0] > 100 || record.durationMs > 25) {
        if (events.length < limit) events.push({ ...record, firstUpdate, failed, skipped, context: context(),
          previousUpdate: previous.get(this) ?? null,
          stack: skipped > 0 ? new Error('Playback skipped frames').stack : null });
        else dropped++;
      }
      previous.set(this, record);
    }
  };
  Object.defineProperty(owner, 'update', { ...descriptor, value: replacement });
  return {
    snapshot() { return { events, dropped, limit,
      thresholds: { inputDeltaMs: 100, updateCpuMs: 25 },
      limitations: ['Opt-in method wrapping, getInfo and records add diagnostic overhead.',
        'Input delta is the caller-supplied playback advance, not proof of CPU work during the whole gap.',
        'No delta is changed and no skipped-frame counter is reset or subtracted.'] }; },
    restore() { if (owner.update === replacement) Object.defineProperty(owner, 'update', descriptor); },
  };
}
