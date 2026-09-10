import type { Vec3 } from "../server/simulation/types";

/** Cooldown for a caller that must never rearm, finite so it still serializes. */
const ONCE = 1e9;
const DEFAULT_DOOR_SOUND = "sounds/movers/door_start.ogg";
const DEFAULT_PLAT_SOUND = "sounds/movers/elevator_move.ogg";
const DEFAULT_STOP_SOUND = "sounds/movers/door_stop.ogg";

export interface LiftDefinition {
  modelIndex: number;
  min: Vec3;
  max: Vec3;
  origin: Vec3;
  height: number;
  speed: number;
  wait: number;
  automatic: boolean;
  start: number;
  end: number;
  plat: boolean;
  toggle: boolean;
  /** Asset paths for the move/arrive one-shots. Presentation only; never simulated. */
  sound: string;
  soundStop: string;
  triggers: Array<{ min: Vec3; max: Vec3; wait: number }>;
}
export interface LiftState {
  modelIndex: number;
  offset: number;
  /** Logical rest/outbound/activated/return states (a downward door's 'up' goes down). */
  phase: "bottom" | "up" | "top" | "down";
  remaining: number;
  cooldowns: number[];
}
export interface LiftActor {
  position: Vec3;
  velocity: Vec3;
  /**
   * Corpses and dropped items ride a lift but must never call one or hold it
   * open, or a gun left on a plat would pin it at the top for the whole match.
   */
  passive?: boolean;
}
export interface LiftTrace {
  fraction: number;
  solid: boolean;
  normalY: number;
  modelIndex: number;
}
export type LiftTraceFn = (start: Vec3, end: Vec3, exclude?: number, only?: number) => LiftTrace;

/** BSP plats are authored at the upper stop; simulation starts one height below. */
export function extractLifts(
  entities: readonly { classname: string; properties: Record<string, string> }[],
  models: readonly { mins: readonly number[]; maxs: readonly number[] }[],
): LiftDefinition[] {
  const result: LiftDefinition[] = [];
  const number = (value: string | undefined, fallback: number) => {
    const parsed = value === undefined ? NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  for (const entity of entities) {
    const p = entity.properties;
    const plat = entity.classname === "func_plat";
    if (!plat && !(entity.classname === "func_door" && (p.angle === "-1" || p.angle === "-2"))) continue;
    if (!/^\*\d+$/.test(p.model ?? "")) continue;
    const modelIndex = Number(p.model.slice(1));
    const model = models[modelIndex];
    if (!model || modelIndex === 0) continue;
    const o = (p.origin ?? "0 0 0").trim().split(/\s+/).map(Number);
    if (o.length !== 3 || !o.every(Number.isFinite)) continue;
    const origin = { x: o[0], y: o[2], z: o[1] };
    const height = number(plat ? p.height : undefined, model.maxs[2] - model.mins[2] - number(p.lip, 8));
    if (height <= 0) continue;
    let start = plat ? -height : 0;
    let end = plat ? 0 : p.angle === "-2" ? -height : height;
    if (!plat && number(p.spawnflags, 0) & 1) [start, end] = [end, start];
    const triggers: LiftDefinition["triggers"] = [];
    if (p.targetname)
      for (const trigger of entities) {
        const t = trigger.properties;
        // Callers are authored either as touch volumes or as a solid button the
        // player walks into; both activate on the same bbox overlap.
        const button = trigger.classname === "func_button";
        const once = trigger.classname === "trigger_once";
        if (!button && !once && trigger.classname !== "trigger_multiple") continue;
        if (t.target !== p.targetname) continue;
        const tm = /^\*\d+$/.test(t.model ?? "") ? models[Number(t.model.slice(1))] : undefined;
        if (!tm) continue;
        const to = (t.origin ?? "0 0 0").trim().split(/\s+/).map(Number);
        if (to.length !== 3 || !to.every(Number.isFinite)) continue;
        const wait = number(t.wait, button ? 1 : 0.5);
        triggers.push({
          min: { x: tm.mins[0] + to[0], y: tm.mins[2] + to[2], z: tm.mins[1] + to[1] },
          max: { x: tm.maxs[0] + to[0], y: tm.maxs[2] + to[2], z: tm.maxs[1] + to[1] },
          // A fire-once caller never rearms. A large finite cooldown says that
          // without adding state that has to survive serialization.
          wait: once || wait < 0 ? ONCE : Math.max(0.1, wait),
        });
      }
    result.push({
      modelIndex,
      origin,
      height,
      min: { x: model.mins[0] + origin.x, y: model.mins[2] + origin.y, z: model.mins[1] + origin.z },
      max: { x: model.maxs[0] + origin.x, y: model.maxs[2] + origin.y, z: model.maxs[1] + origin.z },
      speed: Math.max(1, number(p.speed, plat ? 200 : 100)),
      wait: number(p.wait, plat ? 1 : 2),
      sound: p.noise_start ?? p.noise ?? p.sound ?? (plat ? DEFAULT_PLAT_SOUND : DEFAULT_DOOR_SOUND),
      soundStop: p.noise_stop ?? DEFAULT_STOP_SOUND,
      automatic: !p.targetname,
      start,
      end,
      plat,
      triggers,
      toggle: !plat && !!(number(p.spawnflags, 0) & 32),
    });
  }
  return result;
}

/** Fixed-step state shared by authority and prediction. No wall-clock timers or rendering. */
export class LiftSystem {
  private states: LiftState[];
  /** Rendering asks per lift per frame; keep the lookup off the hot path. */
  private readonly byModel = new Map<number, number>();
  constructor(
    readonly definitions: readonly LiftDefinition[],
    private readonly trace: LiftTraceFn,
  ) {
    this.states = definitions.map((d) => ({
      modelIndex: d.modelIndex,
      offset: d.start,
      phase: "bottom",
      remaining: 0,
      cooldowns: d.triggers.map(() => 0),
    }));
    for (let i = 0; i < definitions.length; i++) this.byModel.set(definitions[i].modelIndex, i);
  }
  /** Current rest/travel phase, for presentation that reacts to movement. */
  phase(modelIndex: number): LiftState["phase"] | undefined {
    const i = this.byModel.get(modelIndex);
    return i === undefined ? undefined : this.states[i].phase;
  }
  snapshot(): LiftState[] {
    return this.states.map((s) => ({ ...s, cooldowns: [...s.cooldowns] }));
  }
  restore(states: readonly LiftState[]): void {
    // Only restore map-known, finite state. Never let a packet create geometry.
    for (let i = 0; i < this.states.length; i++) {
      const d = this.definitions[i];
      const s = states.find((s) => s.modelIndex === d.modelIndex);
      if (
        !s ||
        !Number.isFinite(s.offset) ||
        !Number.isFinite(s.remaining) ||
        !["bottom", "up", "top", "down"].includes(s.phase)
      )
        continue;
      this.states[i] = {
        ...s,
        offset: Math.max(Math.min(d.start, d.end), Math.min(Math.max(d.start, d.end), s.offset)),
        remaining: Math.max(0, s.remaining),
        cooldowns: d.triggers.map((t, j) => {
          const c = s.cooldowns?.[j];
          return Number.isFinite(c) ? Math.max(0, Math.min(t.wait, c)) : 0;
        }),
      };
    }
  }
  /** Just the travel offsets, for lag-compensation history. Order matches definitions. */
  offsets(): number[] {
    return this.states.map((s) => s.offset);
  }
  /**
   * Run a query with the movers put back where they were on a recorded tick.
   * A lift is world geometry: rewinding shooters without it lets a plat that has
   * since risen block a shot that was clear when the player took it.
   */
  rewind<T>(offsets: readonly number[], query: () => T): T {
    const saved = this.states.map((s) => s.offset);
    for (let i = 0; i < this.states.length; i++) {
      const o = offsets[i];
      if (Number.isFinite(o)) this.states[i].offset = o;
    }
    try {
      return query();
    } finally {
      for (let i = 0; i < this.states.length; i++) this.states[i].offset = saved[i];
    }
  }
  offset(modelIndex: number): Vec3 | undefined {
    const i = this.byModel.get(modelIndex);
    if (i === undefined) return undefined;
    const o = this.definitions[i].origin;
    return { x: o.x, y: o.y + this.states[i].offset, z: o.z };
  }
  step(dt: number, actors: readonly LiftActor[]): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    for (let i = 0; i < this.states.length; i++) {
      const d = this.definitions[i];
      const s = this.states[i];
      let activated = false;
      for (let j = 0; j < d.triggers.length; j++) {
        s.cooldowns[j] = Math.max(0, s.cooldowns[j] - dt);
        const t = d.triggers[j];
        if (s.cooldowns[j] === 0 && actors.some((a) => !a.passive && overlaps(a.position, t.min, t.max))) {
          activated = true;
          s.cooldowns[j] = t.wait;
        }
      }
      // Trigger callers may be far from the car. Only nearby bodies need costly
      // support/push traces; include the entire possible movement this tick.
      const padding = d.speed * dt + 2;
      const nearby = actors.filter((a) =>
        overlaps(
          a.position,
          { x: d.min.x, y: d.min.y + s.offset - padding, z: d.min.z },
          { x: d.max.x, y: d.max.y + s.offset + padding, z: d.max.z },
        ),
      );
      const riders = new Set<LiftActor>();
      for (const a of nearby) {
        if (a.velocity.y > 1) continue; // A jumping player detaches.
        const hit = this.trace(a.position, { ...a.position, y: a.position.y - 2 });
        if (hit.fraction < 1 && hit.normalY > 0.7 && hit.modelIndex === d.modelIndex) riders.add(a);
      }
      activated ||= d.automatic && actors.some((a) => !a.passive && this.inTrigger(d, a.position));
      if (activated) {
        if (d.toggle && (s.phase === "up" || s.phase === "top")) s.phase = "down";
        else if (s.phase === "bottom" || s.phase === "down") s.phase = "up";
      }
      if (s.phase === "top") {
        const hold = d.plat ? [...riders].some((a) => !a.passive) : activated;
        s.remaining = hold ? Math.max(0, d.wait) : Math.max(0, s.remaining - dt);
        if (!d.toggle && d.wait >= 0 && s.remaining <= 0 && !hold) s.phase = "down";
      }
      if (s.phase !== "up" && s.phase !== "down") continue;
      const oldOffset = s.offset;
      const target = s.phase === "up" ? d.end : d.start;
      const next = oldOffset + Math.sign(target - oldOffset) * Math.min(Math.abs(target - oldOffset), d.speed * dt);
      const delta = next - oldOffset;
      const pushed: Array<{ actor: LiftActor; end: Vec3 }> = [];
      let blocked = false;
      for (const a of nearby) {
        // Relative sweep catches the moving brush hitting a non-rider, including its underside.
        const contact = this.trace(a.position, { ...a.position, y: a.position.y - delta }, undefined, d.modelIndex);
        if (!riders.has(a) && contact.fraction === 1 && !contact.solid) continue;
        const end = { ...a.position, y: a.position.y + delta };
        const obstruction = this.trace(a.position, end, d.modelIndex);
        if (obstruction.fraction < 1 || obstruction.solid) {
          blocked = true;
          break;
        }
        pushed.push({ actor: a, end });
      }
      if (blocked) {
        // Roll back the whole move, not just one rider. No crushing damage in this first pass.
        s.phase = s.phase === "up" ? "down" : "up";
        continue;
      }
      s.offset = next;
      for (const p of pushed) Object.assign(p.actor.position, p.end);
      if (s.offset === d.end) {
        s.phase = "top";
        s.remaining = Math.max(0, d.wait);
      } else if (s.offset === d.start) s.phase = "bottom";
    }
  }
  private inTrigger(d: LiftDefinition, p: Vec3): boolean {
    const x0 = Math.min(d.min.x + 33, (d.min.x + d.max.x) / 2);
    const x1 = Math.max(d.max.x - 33, x0 + 1);
    const z0 = Math.min(d.min.z + 33, (d.min.z + d.max.z) / 2);
    const z1 = Math.max(d.max.z - 33, z0 + 1);
    if (!d.plat)
      return overlaps(
        p,
        { x: d.min.x - 16, y: d.min.y + d.start - 16, z: d.min.z - 16 },
        { x: d.max.x + 16, y: d.max.y + d.start + 16, z: d.max.z + 16 },
      );
    return (
      p.x + 16 > x0 &&
      p.x - 16 < x1 &&
      p.z + 16 > z0 &&
      p.z - 16 < z1 &&
      p.y + 40 > d.min.y - d.height &&
      p.y - 24 < d.max.y - d.height + 8
    );
  }
}

function overlaps(p: Vec3, min: Vec3, max: Vec3): boolean {
  return (
    p.x + 16 > min.x && p.x - 16 < max.x && p.y + 40 > min.y && p.y - 24 < max.y && p.z + 16 > min.z && p.z - 16 < max.z
  );
}
