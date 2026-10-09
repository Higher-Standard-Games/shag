import { type CameraKeyframe, interpolatePath } from "../demo/CinematicCameraPaths";
import { summarizeTimedemoBundles, type TimedemoBundleCounters } from "./TimedemoBundles";

export interface TimedemoSegment {
  name: string;
  start: number;
  end: number;
  camera: "freefly" | "spectator";
  /** Seeded priority order, saved by the authoring recipe. First alive target wins. */
  targets?: string[];
  keyframes?: CameraKeyframe[];
}

export interface TimedemoFixture {
  schemaVersion: 1;
  id: string;
  demo: { file: string; sha256: string; map: string; players: number; tickRate: number; version: number };
  startSeconds: number;
  durationSeconds: number;
  seed: number;
  profile: { width: number; height: number; fov: number; requiredCvars: Record<string, number> };
  segments: TimedemoSegment[];
  provenance: Record<string, unknown>;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export const isFixtureId = (id: string): boolean => typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(id);

/** Validate before loading a map or terminating a live session. */
export function validateTimedemoFixture(value: unknown): TimedemoFixture {
  const f = value as TimedemoFixture;
  if (!f || f.schemaVersion !== 1) throw new Error("Unsupported timedemo fixture. Regenerate with the current recipe.");
  if (!isFixtureId(f.id ?? "")) throw new Error("Invalid fixture ID");
  if (!f.demo || !/^[a-f0-9]{64}$/.test(f.demo.sha256) || f.demo.file !== "demo.shagdemo") {
    throw new Error("Invalid timedemo recording reference/hash");
  }
  if (
    !/^[a-zA-Z0-9_-]+$/.test(f.demo.map) ||
    !Number.isInteger(f.demo.players) ||
    f.demo.players < 1 ||
    f.demo.players > 10 ||
    !finite(f.demo.tickRate) ||
    f.demo.tickRate <= 0 ||
    !Number.isInteger(f.demo.version) ||
    f.demo.version < 1
  ) {
    throw new Error("Invalid timedemo map/player/tick metadata");
  }
  if (
    !finite(f.startSeconds) ||
    f.startSeconds < 0 ||
    !finite(f.durationSeconds) ||
    f.durationSeconds < 1 ||
    f.durationSeconds > 120
  ) {
    throw new Error("Invalid timedemo interval (duration must be 1–120 seconds)");
  }
  if (!Number.isInteger(f.seed) || f.seed < 0 || f.seed > 4294967295) throw new Error("Invalid fixture seed");
  const p = f.profile;
  if (
    !p ||
    !Number.isInteger(p.width) ||
    !Number.isInteger(p.height) ||
    p.width < 320 ||
    p.height < 180 ||
    p.width > 4096 ||
    p.height > 2160 ||
    !finite(p.fov) ||
    p.fov < 30 ||
    p.fov > 120 ||
    !p.requiredCvars ||
    typeof p.requiredCvars !== "object" ||
    Array.isArray(p.requiredCvars)
  ) {
    throw new Error("Invalid timedemo profile");
  }
  for (const [name, n] of Object.entries(p.requiredCvars)) {
    if (!/^(r_|cl_)[a-z0-9_]+$/.test(name) || !finite(n)) throw new Error("Invalid profile cvar requirement");
  }
  if (!Array.isArray(f.segments) || !f.segments.length || f.segments.length > 32)
    throw new Error("Missing camera schedule");
  let end = 0;
  const names = new Set<string>();
  for (const s of f.segments) {
    if (
      !s ||
      typeof s.name !== "string" ||
      !s.name ||
      names.has(s.name) ||
      s.start !== end ||
      !finite(s.end) ||
      s.end <= s.start ||
      s.end > f.durationSeconds
    )
      throw new Error("Camera schedule must have unique names and contiguous ordered intervals");
    names.add(s.name);
    if (s.camera === "spectator") {
      if (
        !Array.isArray(s.targets) ||
        !s.targets.length ||
        s.targets.length > 10 ||
        s.targets.some((id) => !/^player_\d+$/.test(id))
      )
        throw new Error("Invalid saved spectator target schedule");
    } else if (s.camera === "freefly") {
      if (!Array.isArray(s.keyframes) || s.keyframes.length < 2 || s.keyframes.length > 2000)
        throw new Error("Missing freefly route");
      let tick = -Infinity;
      for (const k of s.keyframes) {
        if (
          !finite(k.tick) ||
          k.tick <= tick ||
          !k.position ||
          !k.lookAt ||
          ![k.position.x, k.position.y, k.position.z, k.lookAt.x, k.lookAt.y, k.lookAt.z].every(finite)
        )
          throw new Error("Invalid route coordinates/times");
        if (k.position.x === k.lookAt.x && k.position.y === k.lookAt.y && k.position.z === k.lookAt.z)
          throw new Error("Route has a zero look direction");
        if (k.fov !== undefined && (!finite(k.fov) || k.fov < 30 || k.fov > 120)) throw new Error("Invalid route FOV");
        tick = k.tick;
      }
      if (s.keyframes[0].tick > s.start || s.keyframes[s.keyframes.length - 1].tick < s.end)
        throw new Error("Route does not cover its camera interval");
    } else throw new Error("Unknown benchmark camera mode");
    end = s.end;
  }
  if (end !== f.durationSeconds) throw new Error("Camera schedule does not cover the benchmark");
  return f;
}

export function segmentAt(f: TimedemoFixture, seconds: number): TimedemoSegment {
  return f.segments.find((s) => seconds < s.end) ?? f.segments[f.segments.length - 1];
}

/** Demo entities may remain present while dead; combat_state is authoritative. */
export function selectTimedemoTarget(
  targets: string[],
  state: {
    entities: { has(id: string): boolean };
    events: readonly { type: string; entityId?: string; dead?: boolean }[];
  } | null,
): string | null {
  if (!state) return null;
  const dead = new Set(state.events.filter((e) => e.type === "combat_state" && e.dead).map((e) => e.entityId));
  return targets.find((id) => state.entities.has(id) && !dead.has(id)) ?? null;
}

/** Route keyframe ticks are seconds relative to the measured interval. */
export function sampleTimedemoCamera(segment: TimedemoSegment, seconds: number) {
  if (segment.camera !== "freefly" || !segment.keyframes) throw new Error("Not a freefly segment");
  return interpolatePath(segment.keyframes, seconds);
}

export interface TimedemoSample {
  seconds: number;
  phase: string;
  wallMs: number;
  /** Page performance.now() at the benchmark hook, before playback. Wall intervals end here. */
  frameAtMs?: number;
  playbackCpuMs: number;
  sceneCpuMs: number;
  animationMs: number;
  drawCalls: number;
  triangles: number;
  activeMeshes: number;
  alivePlayers: number;
  loadedBodies: number;
  spectatorTarget: string | null;
  povWeaponLoaded: boolean;
  /** Full-scene readiness is not queried inside measurement; null means unobserved. */
  sceneReady: boolean | null;
  pendingSceneData?: number;
  skippedFrames: number;
  /** Whole engine-frame bundle submissions; null outside WebGPU NCM or when unavailable. */
  bundles: TimedemoBundleCounters | null;
}

export function summarizeTimedemoSamples(samples: TimedemoSample[], budgetMs = 1000 / 120) {
  const stats = (key: keyof TimedemoSample) => {
    const values = samples
      .map((s) => s[key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    const percentile = (q: number) => {
      if (!values.length) return null;
      const at = (values.length - 1) * q;
      const lo = Math.floor(at);
      return values[lo] + (values[Math.ceil(at)] - values[lo]) * (at - lo);
    };
    return { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) };
  };
  return {
    frames: samples.length,
    wallMs: stats("wallMs"),
    playbackCpuMs: stats("playbackCpuMs"),
    sceneCpuMs: stats("sceneCpuMs"),
    animationMs: stats("animationMs"),
    drawCalls: stats("drawCalls"),
    triangles: stats("triangles"),
    alivePlayers: stats("alivePlayers"),
    loadedBodies: stats("loadedBodies"),
    bundles: summarizeTimedemoBundles(samples),
    missingPovWeaponFrames: samples.filter((s) => s.spectatorTarget && !s.povWeaponLoaded).length,
    unreadySceneFrames: samples.filter((s) => s.sceneReady === false).length,
    sceneReadinessObservedFrames: samples.filter((s) => typeof s.sceneReady === "boolean").length,
    pendingSceneDataFrames: samples.some((s) => typeof s.pendingSceneData === "number")
      ? samples.filter((s) => (s.pendingSceneData ?? 0) > 0).length
      : null,
    frameBudgetMs: budgetMs,
    overBudgetPercent: samples.length
      ? (100 * samples.filter((s) => s.wallMs > budgetMs).length) / samples.length
      : null,
  };
}

export function timedemoPercentiles(values: readonly number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (q: number) => {
    if (!sorted.length) return null;
    const at = (sorted.length - 1) * q,
      lo = Math.floor(at);
    return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo);
  };
  return { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) };
}
