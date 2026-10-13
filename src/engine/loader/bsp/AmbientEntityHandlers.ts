/**
 * Map ambience the client owns alone: `target_speaker` sounds and spinning
 * `func_rotating` brushes. Neither touches gameplay, so neither is networked;
 * both stop with the map.
 *
 * Triggered variants (a `targetname` someone has to fire) need entity
 * triggering on the client, which does not exist yet: a triggered speaker is
 * left unhandled, and a triggered rotator is built but stands still.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { AudioManager } from "../../AudioManager";
import type { SfxLoop } from "../../audio/AudioV2Sfx";
import { type EntityData, EntityHandlerRegistry, type EntityHandlerResult } from "../../core/EntityHandlerRegistry";
import type { BspFile } from "./BspLoader";
import { buildBrushModel } from "./BspMeshBuilder";

const SPEAKER_LOOPED_ON = 1;
const SPEAKER_LOOPED_OFF = 2;
const SPEAKER_GLOBAL = 4;
const ROTATING_START_ON = 1;
const ROTATING_REVERSE = 2;
const ROTATING_X_AXIS = 4;
const ROTATING_Y_AXIS = 8;

function parseQ3Vector(value: string | undefined): [number, number, number] | null {
  const parts = value?.trim().split(/\s+/).map(Number);
  if (!parts || parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2]];
}

const q3ToEngine = ([x, y, z]: [number, number, number]) => new Vector3(x, z, y);
const flags = (entity: EntityData) => Number.parseInt(entity.properties.spawnflags ?? "0", 10) || 0;
const number = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

export type SpeakerPlan =
  | {
      kind: "loop" | "periodic";
      path: string;
      /** Engine-world position, or null for a sound heard everywhere. */
      position: Vector3 | null;
      volume: number;
      /** The speaker's `attenuation`, on the engine's distance curve. */
      attenuation: number;
      /** `periodic`: seconds between plays, and how much each wait may vary. */
      wait: number;
      random: number;
    }
  | { kind: "skip"; reason: string };

/** What a `target_speaker` does on the client, from its keys. */
export function speakerPlan(entity: EntityData): SpeakerPlan {
  const p = entity.properties;
  const path = p.noise?.trim();
  if (!path) return { kind: "skip", reason: "no noise" };
  // "*name" sounds are the activating player's own voice: they need a trigger
  if (path.startsWith("*")) return { kind: "skip", reason: "player sound" };

  const spawnflags = flags(entity);
  const origin = parseQ3Vector(p.origin);
  const attenuation = number(p.attenuation, 1);
  const global = (spawnflags & SPEAKER_GLOBAL) !== 0 || attenuation <= 0 || !origin;
  const base = {
    path,
    position: global ? null : q3ToEngine(origin!),
    volume: Math.max(0, number(p.volume, 1)),
    attenuation,
    wait: Math.max(0, number(p.wait, 0)),
    random: Math.max(0, number(p.random, 0)),
  };

  if ((spawnflags & SPEAKER_LOOPED_ON) !== 0 && (spawnflags & SPEAKER_LOOPED_OFF) === 0) {
    return { kind: "loop", ...base };
  }
  if (p.targetname) return { kind: "skip", reason: "triggered" };
  if (base.wait > 0) return { kind: "periodic", ...base };
  return { kind: "skip", reason: "plays only when triggered" };
}

export interface RotationPlan {
  /** Engine-space axis, already flipped for the change of handedness. */
  axis: Vector3;
  degreesPerSecond: number;
  /** False for a rotator that waits for a trigger. */
  spinning: boolean;
}

/**
 * How a `func_rotating` spins. Quake turns about its vertical axis unless
 * spawnflags pick X (4) or Y (8); 2 reverses. The Quake-to-engine axis swap
 * mirrors space, which turns every rotation the other way.
 */
export function rotationPlan(entity: EntityData): RotationPlan {
  const spawnflags = flags(entity);
  const q3Axis: [number, number, number] =
    (spawnflags & ROTATING_X_AXIS) !== 0 ? [1, 0, 0] : (spawnflags & ROTATING_Y_AXIS) !== 0 ? [0, 1, 0] : [0, 0, 1];
  const reverse = (spawnflags & ROTATING_REVERSE) !== 0;
  const speed = number(entity.properties.speed, 0) || 100;
  return {
    axis: q3ToEngine(q3Axis),
    degreesPerSecond: reverse ? speed : -speed,
    spinning: !entity.properties.targetname || (spawnflags & ROTATING_START_ON) !== 0,
  };
}

let currentBsp: BspFile | null = null;

/** The map whose inline models `func_rotating` builds from. */
export function setAmbientEntityBsp(bsp: BspFile | null): void {
  currentBsp = bsp;
}

async function handleTargetSpeaker(entity: EntityData, scene: Scene): Promise<EntityHandlerResult> {
  const plan = speakerPlan(entity);
  if (plan.kind === "skip") return { handled: false };

  // The node carries the speaker's lifetime: disposing the map disposes it
  const node = new TransformNode(`target_speaker:${plan.path}`, scene);
  if (plan.position) node.position.copyFrom(plan.position);
  node.metadata = { mapOwned: true, isMover: true, entityType: "target_speaker" };
  const audio = AudioManager.getInstance();
  const options = { volume: plan.volume, attenuation: plan.attenuation };

  if (plan.kind === "loop") {
    let loop: SfxLoop | null = null;
    let disposed = false;
    node.onDisposeObservable.addOnce(() => {
      disposed = true;
      loop?.stop();
    });
    void audio.playLoop3D(plan.path, plan.position, options).then((started) => {
      if (disposed) started?.stop();
      else loop = started;
    });
    return { handled: true, node };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    const seconds = Math.max(0.05, plan.wait + (Math.random() * 2 - 1) * plan.random);
    timer = setTimeout(() => {
      if (plan.position) audio.playSfx3D(plan.path, plan.position, options);
      else audio.playSfx2D(plan.path, plan.volume);
      schedule();
    }, seconds * 1000);
  };
  schedule();
  node.onDisposeObservable.addOnce(() => {
    if (timer) clearTimeout(timer);
  });
  return { handled: true, node };
}

async function handleFuncRotating(entity: EntityData, scene: Scene): Promise<EntityHandlerResult> {
  const bsp = currentBsp;
  const modelIndex = Number.parseInt(entity.properties.model?.replace(/^\*/, "") ?? "", 10);
  if (!bsp || !Number.isInteger(modelIndex) || modelIndex <= 0) return { handled: false };
  const mesh = await buildBrushModel(bsp, modelIndex, scene, `func_rotating_${modelIndex}`);
  if (!mesh) return { handled: false };
  mesh.metadata = { ...mesh.metadata, mapOwned: true, isMover: true, entityType: "func_rotating" };

  // An origin brush stores the model relative to its origin; without one the
  // model sits where it is and turns about the origin key, if any.
  const origin = parseQ3Vector(entity.properties.origin);
  if (origin) {
    const model = bsp.models[modelIndex];
    const inside = [0, 1, 2].every((i) => origin[i] >= model.mins[i] - 1 && origin[i] <= model.maxs[i] + 1);
    if (inside) {
      mesh.setPivotPoint(q3ToEngine(origin));
    } else {
      mesh.setPivotPoint(Vector3.Zero());
      mesh.position.copyFrom(q3ToEngine(origin));
    }
  }

  const plan = rotationPlan(entity);
  if (plan.spinning) {
    const radiansPerMs = (plan.degreesPerSecond * Math.PI) / 180 / 1000;
    const observer = scene.onBeforeRenderObservable.add(() => {
      mesh.rotate(plan.axis, radiansPerMs * scene.getEngine().getDeltaTime());
    });
    mesh.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(observer));
  }
  return { handled: true, node: mesh };
}

export function registerAmbientEntityHandlers(): void {
  EntityHandlerRegistry.register("target_speaker", handleTargetSpeaker);
  EntityHandlerRegistry.register("func_rotating", handleFuncRotating);
}

export function unregisterAmbientEntityHandlers(): void {
  EntityHandlerRegistry.unregister("target_speaker");
  EntityHandlerRegistry.unregister("func_rotating");
}
