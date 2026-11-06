/** Join the tail into the head with an equal-power overlap, shortening the loop. */
export function overlapLoopChannel(samples: Float32Array, overlapFrames: number) {
  const overlap = Number.isFinite(overlapFrames)
    ? Math.min(Math.max(0, Math.floor(overlapFrames)), Math.floor(samples.length / 2))
    : 0;
  if (overlap < 2) return samples.slice();
  const length = samples.length - overlap;
  const result = samples.slice(0, length);
  for (let i = 0; i < overlap; i++) {
    const angle = (i / (overlap - 1)) * (Math.PI / 2);
    result[i] = samples[length + i] * Math.cos(angle) + samples[i] * Math.sin(angle);
  }
  return result;
}
