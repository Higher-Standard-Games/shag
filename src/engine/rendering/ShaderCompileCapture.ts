/**
 * Which shaders compile during play, and why.
 *
 * Babylon counts compilations but does not say what compiled. A capture wraps
 * the engine's createEffect and _releaseEffect for its duration and reports
 * each effect built, beside the closest one that existed before it: the
 * defines that differ usually name the cause (a light count, fog, bones, ...).
 *
 * The engine drops an effect from its cache when the last material using it is
 * disposed, and the next identical material compiles it again. Such rebuilds
 * are counted per key, since a cache snapshot would miss an effect built and
 * released inside the window.
 */

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Effect } from "@babylonjs/core/Materials/effect";

export interface CompiledShader {
  name: string;
  /** Defines this effect has that its closest earlier sibling lacks. */
  added: string[];
  /** Defines the closest earlier sibling had that this effect lacks. */
  removed: string[];
  /** False when no effect of this shader existed before the capture. */
  hadSibling: boolean;
}

export interface ShaderCompileReport {
  durationSeconds: number;
  shaders: CompiledShader[];
  /** Effects released (dropped from the cache) during the capture, by shader. */
  released: Record<string, number>;
  /** Keys compiled more than once in the capture: built, released, built again. */
  rebuilt: { name: string; times: number }[];
}

function compiledEffects(engine: AbstractEngine): Effect[] {
  const cache = (engine as unknown as { _compiledEffects?: Record<string, Effect> })._compiledEffects;
  return cache ? Object.values(cache) : [];
}

function shaderName(effect: Effect): string {
  const name = effect.name as unknown;
  if (typeof name === "string") return name;
  const path = name as { vertex?: string; fragment?: string; vertexElement?: string; fragmentElement?: string };
  return path.vertex ?? path.vertexElement ?? path.fragment ?? path.fragmentElement ?? "unnamed";
}

function defineSet(effect: Effect): Set<string> {
  return new Set(
    (effect.defines ?? "")
      .split("\n")
      .map((line) => line.replace(/^#define\s+/, "").trim())
      .filter(Boolean),
  );
}

/** The new effect against the earlier sibling it differs from least. */
export function describeNewEffect(effect: Effect, before: readonly Effect[]): CompiledShader {
  const name = shaderName(effect);
  const mine = defineSet(effect);
  let best: { added: string[]; removed: string[] } | null = null;
  for (const other of before) {
    if (shaderName(other) !== name) continue;
    const theirs = defineSet(other);
    const added = [...mine].filter((d) => !theirs.has(d));
    const removed = [...theirs].filter((d) => !mine.has(d));
    if (!best || added.length + removed.length < best.added.length + best.removed.length) best = { added, removed };
  }
  return { name, added: best?.added ?? [], removed: best?.removed ?? [], hadSibling: best !== null };
}

type EffectHooks = {
  createEffect: (...args: unknown[]) => Effect;
  _releaseEffect?: (effect: Effect) => void;
};

export async function captureShaderCompiles(engine: AbstractEngine, seconds: number): Promise<ShaderCompileReport> {
  const hooks = engine as unknown as EffectHooks;
  const before = compiledEffects(engine);
  const seen = new WeakSet<Effect>(before);
  const shaders: CompiledShader[] = [];
  const builds = new Map<string, { name: string; times: number }>();
  const released: Record<string, number> = {};
  const create = hooks.createEffect;
  const release = hooks._releaseEffect;
  hooks.createEffect = function (this: AbstractEngine, ...args: unknown[]) {
    const effect = create.apply(this, args);
    if (!seen.has(effect)) {
      seen.add(effect);
      shaders.push(describeNewEffect(effect, before));
      const key = (effect as unknown as { _key?: string })._key ?? `${shaderName(effect)}@${effect.defines}`;
      const entry = builds.get(key) ?? { name: shaderName(effect), times: 0 };
      entry.times++;
      builds.set(key, entry);
    }
    return effect;
  };
  if (release) {
    hooks._releaseEffect = function (this: AbstractEngine, effect: Effect) {
      const cached = compiledEffects(engine).includes(effect);
      release.call(this, effect);
      if (cached && !compiledEffects(engine).includes(effect)) {
        const name = shaderName(effect);
        released[name] = (released[name] ?? 0) + 1;
        // Released, so a later identical material compiles a new effect
        seen.delete(effect);
      }
    };
  }
  try {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  } finally {
    hooks.createEffect = create;
    if (release) hooks._releaseEffect = release;
  }
  const rebuilt = [...builds.values()].filter((entry) => entry.times > 1).sort((a, b) => b.times - a.times);
  return { durationSeconds: seconds, shaders, released, rebuilt };
}

export function formatShaderCompileReport(report: ShaderCompileReport, limit = 40): string {
  const byName = new Map<string, number>();
  for (const shader of report.shaders) byName.set(shader.name, (byName.get(shader.name) ?? 0) + 1);
  const releasedTotal = Object.values(report.released).reduce((sum, n) => sum + n, 0);
  const lines = [
    `Shader compiles: ${report.shaders.length} in ${report.durationSeconds}s, ${releasedTotal} released`,
    ...[...byName].sort((a, b) => b[1] - a[1]).map(([name, count]) => `  ${name}: ${count}`),
  ];
  if (releasedTotal) {
    lines.push(
      `Released: ${Object.entries(report.released)
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => `${name} ${n}`)
        .join(", ")}`,
    );
  }
  for (const entry of report.rebuilt) lines.push(`  rebuilt ${entry.times}x: ${entry.name} (same defines each time)`);
  for (const shader of report.shaders.slice(0, limit)) {
    const diff = shader.hadSibling
      ? [...shader.added.map((d) => `+${d}`), ...shader.removed.map((d) => `-${d}`)].join(" ") || "(same defines)"
      : "(first of its kind)";
    lines.push(`  ${shader.name}: ${diff}`);
  }
  if (report.shaders.length > limit) lines.push(`  … ${report.shaders.length - limit} more`);
  return lines.join("\n");
}
