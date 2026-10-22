export function timestamps(frames, fps) {
  return Array.from({ length: frames + 1 }, (_, i) => Math.round(i * 1e6 / fps));
}

// Integrate a speed that is linear within each output-time segment.
export function sourceAt(outputSeconds, segments) {
  let source = 0;
  for (const segment of segments) {
    const span = segment.end - segment.start;
    const dt = Math.max(0, Math.min(span, outputSeconds - segment.start));
    source += segment.from * dt + (segment.to - segment.from) * dt * dt / (2 * span);
  }
  return source;
}

export function outputAt(sourceSeconds, segments) {
  let low = 0, high = segments.at(-1).end;
  if (sourceSeconds < 0 || sourceSeconds > sourceAt(high, segments)) throw new Error('Outside timeline');
  for (let i = 0; i < 55; i++) {
    const mid = (low + high) / 2;
    if (sourceAt(mid, segments) < sourceSeconds) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
