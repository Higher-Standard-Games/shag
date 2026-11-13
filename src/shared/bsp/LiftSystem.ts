import type { Vec3 } from "../server/simulation/types";

/** Cooldown for a caller that must never rearm, finite so it still serializes. */
const ONCE = 1e9;
/** Q3 dealt a mover's `dmg` once per 50ms server frame; hold that rate. */
const CRUSH_RATE_HZ = 20;
const NO_CRUSHES: readonly LiftCrush[] = Object.freeze([]);
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
  /** Q3 `dmg` dealt to whoever blocks this mover. 0 disables crushing. */
  damage: number;
  /** Q3 CRUSHER spawnflag: keep pushing when blocked instead of reversing. */
  crusher: boolean;
  triggers: LiftCaller[];
}
/** Something that calls a lift: a touch volume, or a `func_button`. */
export interface LiftCaller {
  min: Vec3;
  max: Vec3;
  wait: number;
  /**
   * A button with `health` fires when it takes damage and ignores touch.
   * `parts` are its brushes' boxes at rest, which a direct hit must land on.
   */
  shot?: { parts: Array<{ min: Vec3; max: Vec3 }> };
  /** The button's inline model, which presses in while this caller rests. */
  button?: LiftButton;
}
/** How a `func_button` brush presses in: `push` is the full travel, at `speed` units/s. */
export interface LiftButton {
  modelIndex: number;
  push: Vec3;
  speed: number;
}
/** Q3-space brush boxes of an inline model, for direct-hit tests on shootable buttons. */
export type InlineModelBrushBoxes = (modelIndex: number) => Array<{ mins: readonly number[]; maxs: readonly number[] }>;
export interface LiftState {
  modelIndex: number;
  offset: number;
  /** Logical rest/outbound/activated/return states (a downward door's 'up' goes down). */
  phase: "bottom" | "up" | "top" | "down";
  remaining: number;
  cooldowns: number[];
}
/** A body squashed by a blocked mover, for the caller to turn into damage. */
export interface LiftCrush {
  /** The caller's own handle from LiftActor.id, passed through untouched. */
  id: number | undefined;
  modelIndex: number;
  /** Damage for this step, already scaled to the tick length. */
  damage: number;
}

export interface LiftActor {
  position: Vec3;
  velocity: Vec3;
  /** Caller's handle, echoed back in LiftCrush. Never interpreted here. */
  id?: number;
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
  brushBoxes?: InlineModelBrushBoxes,
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
        const tmIndex = /^\*\d+$/.test(t.model ?? "") ? Number(t.model.slice(1)) : -1;
        const tm = tmIndex > 0 ? models[tmIndex] : undefined;
        if (!tm) continue;
        const to = (t.origin ?? "0 0 0").trim().split(/\s+/).map(Number);
        if (to.length !== 3 || !to.every(Number.isFinite)) continue;
        // A button stays pressed 3 s unless told otherwise, as in Warsow; a
        // `wait` of 0 also means the default there.
        const wait = button ? number(t.wait, 3) || 3 : number(t.wait, 0.5);
        const caller: LiftCaller = {
          min: { x: tm.mins[0] + to[0], y: tm.mins[2] + to[2], z: tm.mins[1] + to[1] },
          max: { x: tm.maxs[0] + to[0], y: tm.maxs[2] + to[2], z: tm.maxs[1] + to[1] },
          // A fire-once caller never rearms. A large finite cooldown says that
          // without adding state that has to survive serialization.
          wait: once || wait < 0 ? ONCE : Math.max(0.1, wait),
        };
        if (button) {
          caller.button = buttonTravel(tmIndex, tm, t);
          // Any nonzero health makes the button shootable, and then touch does nothing.
          if (number(t.health, 0) !== 0) {
            const boxes = brushBoxes?.(tmIndex) ?? [];
            caller.shot = {
              parts: (boxes.length ? boxes : [tm]).map((b) => ({
                min: { x: b.mins[0] + to[0], y: b.mins[2] + to[2], z: b.mins[1] + to[1] },
                max: { x: b.maxs[0] + to[0], y: b.maxs[2] + to[2], z: b.maxs[1] + to[1] },
              })),
            };
          }
        }
        triggers.push(caller);
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
      damage: Math.max(0, number(p.dmg, 2)),
      crusher: !!(number(p.spawnflags, 0) & 4),
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

/**
 * Q3 func_button travel: along its `angle` (-1 up, -2 down, else a yaw), by
 * the model's size on that axis less `lip` (default 4), at `speed` (default 40).
 */
function buttonTravel(
  modelIndex: number,
  model: { mins: readonly number[]; maxs: readonly number[] },
  p: Record<string, string>,
): LiftButton {
  const angle = Number(p.angle ?? 0);
  let dir: [number, number, number];
  if (angle === -1) dir = [0, 0, 1];
  else if (angle === -2) dir = [0, 0, -1];
  else {
    const yaw = ((Number.isFinite(angle) ? angle : 0) * Math.PI) / 180;
    dir = [Math.cos(yaw), Math.sin(yaw), 0];
  }
  const lip = Number(p.lip);
  const size = [0, 1, 2].map((i) => model.maxs[i] - model.mins[i]);
  const distance = Math.max(
    0,
    Math.abs(dir[0]) * size[0] + Math.abs(dir[1]) * size[1] + Math.abs(dir[2]) * size[2] - (lip || 4),
  );
  const speed = Number(p.speed);
  return {
    modelIndex,
    push: { x: dir[0] * distance, y: dir[2] * distance, z: dir[1] * distance },
    speed: speed > 0 ? speed : 40,
  };
}

/** Fixed-step state shared by authority and prediction. No wall-clock timers or rendering. */
export class LiftSystem {
  private states: LiftState[];
  /** Rendering asks per lift per frame; keep the lookup off the hot path. */
  private readonly byModel = new Map<number, number>();
  private readonly _lo: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly _hi: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly _triggerLo: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly _triggerHi: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly _nearby: LiftActor[] = [];
  private readonly _riders = new Set<LiftActor>();
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
    for (let i = 0; i < definitions.length; i++) {
      const triggers = definitions[i].triggers;
      for (let j = 0; j < triggers.length; j++) {
        const button = triggers[j].button;
        if (!button) continue;
        let entry = this.buttonCallers.get(button.modelIndex);
        if (!entry) {
          entry = { button, callers: [] };
          this.buttonCallers.set(button.modelIndex, entry);
          this.buttons.push(button);
        }
        entry.callers.push([i, j]);
      }
    }
  }
  /** Every `func_button` that calls a lift, once each, for collision and rendering. */
  readonly buttons: LiftButton[] = [];
  /** A button targeting two doors is a caller of both; its press reads either. */
  private readonly buttonCallers = new Map<number, { button: LiftButton; callers: Array<[number, number]> }>();
  /**
   * How far a button is pressed in now, from its caller's cooldown: it travels
   * in at its speed and holds until the caller rearms. Derived from simulated
   * state, so prediction, collision and rendering agree without extra data.
   */
  buttonOffset(modelIndex: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    const entry = this.buttonCallers.get(modelIndex);
    if (!entry) return out;
    let held = -1;
    for (const [i, j] of entry.callers) {
      const cooldown = this.states[i].cooldowns[j];
      if (cooldown > 0) held = Math.max(held, this.definitions[i].triggers[j].wait - cooldown);
    }
    if (held < 0) return out;
    const { push, speed } = entry.button;
    const length = Math.hypot(push.x, push.y, push.z);
    const fraction = length > 0 ? Math.min(1, (held * speed) / length) : 1;
    out.x = push.x * fraction;
    out.y = push.y * fraction;
    out.z = push.z * fraction;
    return out;
  }
  /**
   * Damage landed at `point`. A direct hit (`radius` 0) fires a shootable
   * button whose brush it is on; a blast fires one whose bounds lie within
   * `radius`, as Q3 radius damage reached any entity's box. Returns how many
   * lifts were set going.
   */
  strike(point: Vec3, radius = 0): number {
    if (!Number.isFinite(point.x + point.y + point.z)) return 0;
    let fired = 0;
    const offset = this._strikeOffset;
    for (let i = 0; i < this.definitions.length; i++) {
      const d = this.definitions[i];
      const s = this.states[i];
      for (let j = 0; j < d.triggers.length; j++) {
        const t = d.triggers[j];
        if (!t.shot || s.cooldowns[j] > 0) continue;
        if (t.button) this.buttonOffset(t.button.modelIndex, offset);
        else offset.x = offset.y = offset.z = 0;
        const hit =
          radius > 0
            ? distanceToBox(point, t.min, t.max, offset) < radius
            : t.shot.parts.some((part) => distanceToBox(point, part.min, part.max, offset) <= STRIKE_EPSILON);
        if (!hit) continue;
        s.cooldowns[j] = t.wait;
        this.activate(d, s);
        fired++;
      }
    }
    return fired;
  }
  private readonly _strikeOffset: Vec3 = { x: 0, y: 0, z: 0 };
  /** A caller fired: start the lift, reverse a toggle, or hold an open door. */
  private activate(d: LiftDefinition, s: LiftState): void {
    if (d.toggle && (s.phase === "up" || s.phase === "top")) s.phase = "down";
    else if (s.phase === "bottom" || s.phase === "down") s.phase = "up";
    else if (s.phase === "top" && !d.plat) s.remaining = Math.max(0, d.wait);
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
    return this.offsetsInto([]);
  }
  /** `offsets()` written into an array the caller keeps reusing. */
  offsetsInto(out: number[]): number[] {
    out.length = this.states.length;
    for (let i = 0; i < this.states.length; i++) out[i] = this.states[i].offset;
    return out;
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
  /** Current vertical travel of the mover at definitions[index], without allocating. */
  travelAt(index: number): number {
    return this.states[index].offset;
  }
  offset(modelIndex: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 | undefined {
    const i = this.byModel.get(modelIndex);
    if (i === undefined) return undefined;
    const o = this.definitions[i].origin;
    out.x = o.x;
    out.y = o.y + this.states[i].offset;
    out.z = o.z;
    return out;
  }
  /**
   * Advance every mover one fixed step, carrying and pushing the given bodies.
   * Returns whoever got squashed this step, for the caller to turn into damage —
   * the simulation core stays out of the business of hurting anyone.
   */
  step(dt: number, actors: readonly LiftActor[]): readonly LiftCrush[] {
    if (!(dt > 0) || !Number.isFinite(dt)) return NO_CRUSHES;
    let crushes: LiftCrush[] | null = null;
    for (let i = 0; i < this.states.length; i++) {
      const d = this.definitions[i];
      const s = this.states[i];
      let activated = false;
      for (let j = 0; j < d.triggers.length; j++) {
        s.cooldowns[j] = Math.max(0, s.cooldowns[j] - dt);
        const t = d.triggers[j];
        if (!t.shot && s.cooldowns[j] === 0 && actors.some((a) => !a.passive && overlaps(a.position, t.min, t.max))) {
          activated = true;
          s.cooldowns[j] = t.wait;
        }
      }
      // Trigger callers may be far from the car. Only nearby bodies need costly
      // support/push traces; include the entire possible movement this tick.
      // Scratch, reused per lift: this runs for every lift and actor every tick,
      // and almost always finds nobody near.
      const padding = d.speed * dt + 2;
      const lo = this._lo;
      const hi = this._hi;
      lo.x = d.min.x;
      lo.y = d.min.y + s.offset - padding;
      lo.z = d.min.z;
      hi.x = d.max.x;
      hi.y = d.max.y + s.offset + padding;
      hi.z = d.max.z;
      const nearby = this._nearby;
      nearby.length = 0;
      for (const a of actors) if (overlaps(a.position, lo, hi)) nearby.push(a);
      const riders = this._riders;
      riders.clear();
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
        let hold = activated;
        if (d.plat) {
          hold = false;
          for (const a of riders) if (!a.passive) hold = true;
        }
        s.remaining = hold ? Math.max(0, d.wait) : Math.max(0, s.remaining - dt);
        if (!d.toggle && d.wait >= 0 && s.remaining <= 0 && !hold) s.phase = "down";
      }
      if (s.phase !== "up" && s.phase !== "down") continue;
      const oldOffset = s.offset;
      const target = s.phase === "up" ? d.end : d.start;
      const next = oldOffset + Math.sign(target - oldOffset) * Math.min(Math.abs(target - oldOffset), d.speed * dt);
      const delta = next - oldOffset;
      const pushed: Array<{ actor: LiftActor; end: Vec3 }> = [];
      let blocker: LiftActor | undefined;
      for (const a of nearby) {
        // Relative sweep catches the moving brush hitting a non-rider, including its underside.
        const contact = this.trace(a.position, { ...a.position, y: a.position.y - delta }, undefined, d.modelIndex);
        if (!riders.has(a) && contact.fraction === 1 && !contact.solid) continue;
        const end = { ...a.position, y: a.position.y + delta };
        const obstruction = this.trace(a.position, end, d.modelIndex);
        if (obstruction.fraction < 1 || obstruction.solid) {
          blocker = a;
          break;
        }
        pushed.push({ actor: a, end });
      }
      if (blocker) {
        // Roll back the whole move, not just one rider.
        // A body with no simulation of its own cannot be hurt, so it only blocks.
        if (d.damage > 0 && !blocker.passive) {
          if (!crushes) crushes = [];
          crushes.push({
            id: blocker.id,
            modelIndex: d.modelIndex,
            // Q3 dealt `dmg` once per 50ms frame. Hold that rate whatever our
            // tick length is, so crush lethality does not follow the tick rate.
            damage: d.damage * dt * CRUSH_RATE_HZ,
          });
        }
        // A crusher never backs off; everything else reverses (Q3 Blocked_Door).
        if (!d.crusher) s.phase = s.phase === "up" ? "down" : "up";
        continue;
      }
      s.offset = next;
      for (const p of pushed) Object.assign(p.actor.position, p.end);
      if (s.offset === d.end) {
        s.phase = "top";
        s.remaining = Math.max(0, d.wait);
      } else if (s.offset === d.start) s.phase = "bottom";
    }
    return crushes ?? NO_CRUSHES;
  }
  private inTrigger(d: LiftDefinition, p: Vec3): boolean {
    const x0 = Math.min(d.min.x + 33, (d.min.x + d.max.x) / 2);
    const x1 = Math.max(d.max.x - 33, x0 + 1);
    const z0 = Math.min(d.min.z + 33, (d.min.z + d.max.z) / 2);
    const z1 = Math.max(d.max.z - 33, z0 + 1);
    if (!d.plat) {
      const lo = this._triggerLo;
      const hi = this._triggerHi;
      lo.x = d.min.x - 16;
      lo.y = d.min.y + d.start - 16;
      lo.z = d.min.z - 16;
      hi.x = d.max.x + 16;
      hi.y = d.max.y + d.start + 16;
      hi.z = d.max.z + 16;
      return overlaps(p, lo, hi);
    }
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

/** A shot's impact point sits on the brush face, give or take the trace's 2-unit box. */
const STRIKE_EPSILON = 3;

/** Distance from `p` to the box `min`..`max` moved by `shift`; 0 inside it. */
function distanceToBox(p: Vec3, min: Vec3, max: Vec3, shift: Vec3): number {
  const dx = Math.max(min.x + shift.x - p.x, 0, p.x - max.x - shift.x);
  const dy = Math.max(min.y + shift.y - p.y, 0, p.y - max.y - shift.y);
  const dz = Math.max(min.z + shift.z - p.z, 0, p.z - max.z - shift.z);
  return Math.hypot(dx, dy, dz);
}

function overlaps(p: Vec3, min: Vec3, max: Vec3): boolean {
  return (
    p.x + 16 > min.x && p.x - 16 < max.x && p.y + 40 > min.y && p.y - 24 < max.y && p.z + 16 > min.z && p.z - 16 < max.z
  );
}
