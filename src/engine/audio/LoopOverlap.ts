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

/** Play an attack once, blend into the loop's tail, then repeat only the loop. */
export function prependLoopIntro(attack: Float32Array, loop: Float32Array, holdFrames: number, fadeFrames: number) {
  const hold = Math.min(attack.length, Math.max(0, Math.floor(holdFrames)));
  const fade = Math.min(loop.length, attack.length - hold, Math.max(0, Math.floor(fadeFrames)));
  const result = new Float32Array(hold + fade + loop.length);
  result.set(attack.subarray(0, hold));
  for (let i = 0; i < fade; i++) {
    const angle = (fade > 1 ? i / (fade - 1) : 1) * (Math.PI / 2);
    result[hold + i] = attack[hold + i] * Math.cos(angle) + loop[loop.length - fade + i] * Math.sin(angle);
  }
  result.set(loop, hold + fade);
  return result;
}
