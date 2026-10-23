/**
 * Which shaders compile during play, and why.
 *
 * Babylon counts compilations but does not say what compiled. The engine keeps
 * every compiled effect by key, so a capture snapshots that cache, waits, and
 * reports each new effect beside the closest one that already existed: the
 * defines that differ usually name the cause (a light count, fog, bones, ...).
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

export async function captureShaderCompiles(engine: AbstractEngine, seconds: number): Promise<ShaderCompileReport> {
  const before = compiledEffects(engine);
  const known = new Set(before);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const fresh = compiledEffects(engine).filter((effect) => !known.has(effect));
  return { durationSeconds: seconds, shaders: fresh.map((effect) => describeNewEffect(effect, before)) };
}

export function formatShaderCompileReport(report: ShaderCompileReport, limit = 40): string {
  const byName = new Map<string, number>();
  for (const shader of report.shaders) byName.set(shader.name, (byName.get(shader.name) ?? 0) + 1);
  const lines = [
    `Shader compiles: ${report.shaders.length} new in ${report.durationSeconds}s`,
    ...[...byName].sort((a, b) => b[1] - a[1]).map(([name, count]) => `  ${name}: ${count}`),
  ];
  for (const shader of report.shaders.slice(0, limit)) {
    const diff = shader.hadSibling
      ? [...shader.added.map((d) => `+${d}`), ...shader.removed.map((d) => `-${d}`)].join(" ") || "(same defines)"
      : "(first of its kind)";
    lines.push(`  ${shader.name}: ${diff}`);
  }
  if (report.shaders.length > limit) lines.push(`  … ${report.shaders.length - limit} more`);
  return lines.join("\n");
}
