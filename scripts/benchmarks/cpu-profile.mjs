/** CDP can deliver samples out of timestamp order; DevTools sorts them too. */
export function orderedCpuSamples(profile) {
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples) ||
      !Array.isArray(profile.timeDeltas) || profile.samples.length !== profile.timeDeltas.length ||
      !Number.isFinite(profile.startTime) || !Number.isFinite(profile.endTime) || profile.endTime <= profile.startTime)
    throw new Error('Malformed CPU profile');
  let at = profile.startTime;
  const samples = profile.samples.map((id, index) => {
    if (!Number.isFinite(profile.timeDeltas[index])) throw new Error('Invalid CPU sample duration');
    at += profile.timeDeltas[index];
    if (at < profile.startTime || at > profile.endTime) throw new Error('CPU sample timestamp outside capture');
    return { id, at };
  });
  return samples.sort((a, b) => a.at - b.at);
}

/** Keep only the observed interior of a camera phase, with honest hit counts. */
export function sliceCpuProfile(profile, startTime, endTime) {
  if (startTime < profile.startTime || endTime > profile.endTime || endTime <= startTime)
    throw new Error('Invalid CPU slice window');
  const samples = orderedCpuSamples(profile).filter(s => s.at >= startTime && s.at <= endTime);
  if (!samples.length) throw new Error('Empty CPU slice');
  let previous = startTime;
  const hits = new Map();
  const timeDeltas = samples.map(sample => {
    hits.set(sample.id, (hits.get(sample.id) ?? 0) + 1);
    const delta = sample.at - previous; previous = sample.at; return delta;
  });
  return { startTime, endTime, samples: samples.map(s => s.id), timeDeltas,
    nodes: profile.nodes.map(({ positionTicks, ...node }) => ({ ...node, hitCount: hits.get(node.id) ?? 0 })) };
}

/** Aggregate CDP CPU samples, counting recursive functions once in inclusive time. */
export function summarizeCpuProfile(profile, frames = null, windows = null) {
  const samples = orderedCpuSamples(profile);
  if (windows && (!windows.length || windows.some((window, index) =>
    window.start < profile.startTime || window.end > profile.endTime || window.end <= window.start ||
    (index > 0 && window.start < windows[index - 1].end)))) throw new Error('Invalid CPU windows');
  const nodes = new Map(), parents = new Map(), totals = new Map();
  for (const node of profile.nodes) {
    if (nodes.has(node.id) || !node.callFrame) throw new Error('Malformed CPU profile node');
    nodes.set(node.id, node);
    for (const child of node.children ?? []) {
      if (parents.has(child)) throw new Error('CPU profile node has multiple parents');
      parents.set(child, node.id);
    }
  }
  const key = node => JSON.stringify([
    node.callFrame.functionName, node.callFrame.url, node.callFrame.lineNumber, node.callFrame.columnNumber,
  ]);
  const entry = node => {
    const id = key(node);
    if (!totals.has(id)) totals.set(id, { ...node.callFrame, selfMs: 0, inclusiveMs: 0 });
    return totals.get(id);
  };
  let sampledMs = 0;
  let sampledCount = 0;
  let previous = profile.startTime;
  for (const sample of samples) {
    const ms = windows ? windows.reduce((sum, window) =>
      sum + Math.max(0, Math.min(sample.at, window.end) - Math.max(previous, window.start)) / 1000, 0)
      : (sample.at - previous) / 1000;
    previous = sample.at;
    if (ms === 0) continue;
    sampledCount++;
    sampledMs += ms;
    let id = sample.id, node = nodes.get(id);
    if (!node) throw new Error('CPU sample references an unknown node');
    entry(node).selfMs += ms;
    const visited = new Set(), functions = new Set();
    while (id !== undefined) {
      if (visited.has(id)) throw new Error('Cycle in CPU profile');
      visited.add(id);
      node = nodes.get(id);
      if (!node) throw new Error('CPU profile references an unknown parent');
      const functionKey = key(node);
      if (!functions.has(functionKey)) entry(node).inclusiveMs += ms;
      functions.add(functionKey);
      id = parents.get(id);
    }
  }
  const durationMs = windows ? windows.reduce((sum, window) => sum + (window.end - window.start) / 1000, 0)
    : (profile.endTime - profile.startTime) / 1000;
  if (!sampledMs) throw new Error('Empty CPU sample durations');
  const frameCount = Number.isSafeInteger(frames) && frames > 0 ? frames : null;
  const functions = [...totals.values()].map(value => ({
    ...value,
    selfPercent: 100 * value.selfMs / sampledMs,
    inclusivePercent: 100 * value.inclusiveMs / sampledMs,
    selfMsPerFrame: frameCount === null ? null : value.selfMs / frameCount,
    inclusiveMsPerFrame: frameCount === null ? null : value.inclusiveMs / frameCount,
  }));
  return {
    durationMs, sampledMs, unsampledMs: Math.max(0, durationMs - sampledMs), frames: frameCount,
    samples: sampledCount,
    profileSamples: profile.samples.length,
    reorderedSamples: profile.timeDeltas.some(delta => delta < 0),
    bySelf: [...functions].sort((a, b) => b.selfMs - a.selfMs),
    byInclusive: [...functions].sort((a, b) => b.inclusiveMs - a.inclusiveMs),
    limitations: ['Main-thread CPU samples, including idle/GC; inclusive entries overlap.',
      'Profiling and polling add overhead. These frame times are not an unprofiled benchmark.',
      'Frame counts are observed at the capture boundaries, with CDP round-trip uncertainty.'],
  };
}
