/**
 * `misc_particles`: a point that keeps throwing out sprites, such as smoke
 * behind glass or bubbles on slime. Presentation only, so the client owns it
 * alone, and it stops with the map.
 *
 * Each sprite follows the Warsow rules for these emitters: `count` sprites a
 * second, each living `delay` seconds; SPHERICAL throws them every way at
 * `speed`, otherwise along `angles`, spread by `radius`. They fade over their
 * life after a short fade-in, EXPAND_EFFECT grows them up to five times and
 * SHRINK_EFFECT shrinks them away. GRAVITY pulls them down.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { mulberry32, seedFrom } from "../../../shared/DeterministicRng";
import type { EntityData } from "../../core/EntityHandlerRegistry";
import { presentationNow } from "../../core/PresentationTime";
import { PK3TextureLoader } from "../pk3/PK3TextureLoader";
import { Q3ShaderRegistry } from "../shader/Q3ShaderRegistry";
import type { Q3ShaderStage } from "../shader/Q3ShaderTypes";

const SPHERICAL = 1;
const GRAVITY = 4;
const EXPAND_EFFECT = 16;
const SHRINK_EFFECT = 32;
const START_OFF = 64;
/** Warsow ages local sprites in 100 ms frames and fades them in over two. */
const FRAME_SECONDS = 0.1;
const FADE_IN_FRAMES = 2;
/** BspMeshBuilder gives blended map surfaces alphaIndex 0-999 and additive ones 1000+. */
const PARTICLE_ALPHA_INDEX = 999.5;
const GRAVITY_ACCEL = 175;
/** Sprites live this close to the camera only. */
const RANGE = 2500;
/** The most sprites one scene draws, whatever the map asks for. */
const CAPACITY = 512;

export interface ParticlePlan {
  shader: string;
  /** Engine-space emitter position. */
  origin: { x: number; y: number; z: number };
  /** Engine-space unit direction of a non-spherical emitter. */
  forward: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  spherical: boolean;
  speed: number;
  /** Spread at 1024 units along `forward`, in units. */
  spread: number;
  /** Sprites a second. */
  rate: number;
  /** Seconds each sprite lives. */
  life: number;
  /** Sprite radius in units. */
  size: number;
  gravity: boolean;
  expand: boolean;
  shrink: boolean;
}

const number = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** What a `misc_particles` entity emits, or null when it emits nothing on its own. */
export function particlePlan(entity: EntityData): ParticlePlan | null {
  const p = entity.properties;
  const flags = Number.parseInt(p.spawnflags ?? "0", 10) || 0;
  // A START_OFF emitter waits for a trigger, which the client cannot fire.
  if (flags & START_OFF) return null;
  const origin = (p.origin ?? "").trim().split(/\s+/).map(Number);
  if (origin.length !== 3 || !origin.every(Number.isFinite)) return null;
  // The game truncates speed, count and size to bytes; a fractional speed is still.
  const speed = Math.trunc(number(p.speed, 0)) & 255;
  const rate = Math.trunc(number(p.count, 0)) & 255;
  const size = Math.trunc(number(p.size, 16)) & 255 || 16;
  // Whole seconds, as the game stores them.
  const life = Math.trunc(number(p.delay, 0)) & 255 || 4;
  if (rate <= 0 || life <= 0) return null;

  // Q3 angles: pitch, yaw, roll in degrees; negative pitch looks up.
  const angles = (p.angles ?? `0 ${p.angle ?? 0} 0`).trim().split(/\s+/).map(Number);
  const [pitch, yaw, roll] = [0, 1, 2].map((i) => ((Number.isFinite(angles[i]) ? angles[i] : 0) * Math.PI) / 180);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const q3Forward = [cp * cy, cp * sy, -sp];
  const q3Right = [-sr * sp * cy + cr * sy, -sr * sp * sy - cr * cy, -sr * cp];
  const q3Up = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];
  const engine = (v: number[]) => ({ x: v[0], y: v[2], z: v[1] });
  return {
    shader: p.shadername ?? p.shaderName ?? "particle",
    origin: engine(origin),
    forward: engine(q3Forward),
    right: engine(q3Right),
    up: engine(q3Up),
    spherical: (flags & SPHERICAL) !== 0,
    speed,
    spread: (Math.trunc(number(p.radius, 0)) & 255) * 25,
    rate,
    life,
    size,
    gravity: (flags & GRAVITY) !== 0,
    expand: (flags & EXPAND_EFFECT) !== 0 && (flags & SHRINK_EFFECT) === 0,
    shrink: (flags & SHRINK_EFFECT) !== 0 && (flags & EXPAND_EFFECT) === 0,
  };
}

/**
 * Scale and opacity of a sprite `age` seconds into a `life`-second life, as
 * Warsow's local entities draw them. Null once it is gone.
 */
export function spriteLook(
  plan: Pick<ParticlePlan, "life" | "expand" | "shrink">,
  age: number,
): { scale: number; alpha: number } | null {
  const frames = Math.trunc(plan.life * 10);
  const frac = age / FRAME_SECONDS;
  if (frames <= 1 || Math.floor(frac) >= frames - 1) return null;
  const left = Math.min(1, Math.max(0, 1 - frac / (frames - 1)));
  const fadeIn = frames > FADE_IN_FRAMES * 2 ? Math.min(1, frac / FADE_IN_FRAMES) : 1;
  const alpha = Math.min(left, fadeIn);
  if (plan.expand) return { scale: left > 0 ? Math.min(5, 1 + 1 / left) : 5, alpha };
  if (plan.shrink) return { scale: Math.min(1, Math.max(0.1, left + 0.1)), alpha };
  return { scale: 1, alpha };
}

interface Sprite {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  rotation: number;
}

class Emitter {
  readonly sprites: Sprite[] = [];
  private next: number;
  private last: number;
  private readonly random: () => number;

  constructor(
    readonly plan: ParticlePlan,
    now: number,
  ) {
    let seed = 0;
    for (const letter of `${plan.shader}|${plan.origin.x}|${plan.origin.y}|${plan.origin.z}`)
      seed = seedFrom(seed, letter.charCodeAt(0));
    this.random = mulberry32(seed);
    this.next = now;
    this.last = now;
  }

  advance(now: number, near: boolean): void {
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const { plan } = this;
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];
      s.age += dt;
      if (s.age >= plan.life) {
        this.sprites.splice(i, 1);
        continue;
      }
      if (plan.gravity) s.vy -= GRAVITY_ACCEL * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
    }
    const interval = 1000 / plan.rate;
    // Out of range it rests; coming back, it picks up from now rather than catching up.
    if (!near) {
      this.next = now + interval;
      return;
    }
    for (let emitted = 0; now >= this.next && emitted < 8; emitted++) {
      this.sprites.push(this.spawn((now - this.next) / 1000));
      this.next += interval;
    }
    if (now >= this.next) this.next = now + interval;
  }

  private spawn(age: number): Sprite {
    const { plan, random } = this;
    let dx: number;
    let dy: number;
    let dz: number;
    if (plan.spherical) {
      // Every direction alike: a uniform point on the sphere.
      const u = random() * 2 - 1;
      const a = random() * Math.PI * 2;
      const ring = Math.sqrt(1 - u * u);
      dx = Math.cos(a) * ring;
      dy = u;
      dz = Math.sin(a) * ring;
    } else {
      const a = Math.PI * (random() * 2 - 1);
      const s = random();
      const r = s * Math.cos(a) * plan.spread;
      const u = s * Math.sin(a) * plan.spread;
      dx = plan.forward.x * 1024 + plan.right.x * r + plan.up.x * u;
      dy = plan.forward.y * 1024 + plan.right.y * r + plan.up.y * u;
      dz = plan.forward.z * 1024 + plan.right.z * r + plan.up.z * u;
      const length = Math.hypot(dx, dy, dz) || 1;
      dx /= length;
      dy /= length;
      dz /= length;
    }
    return {
      x: plan.origin.x + dx * plan.speed * age,
      y: plan.origin.y + dy * plan.speed * age,
      z: plan.origin.z + dz * plan.speed * age,
      vx: dx * plan.speed,
      vy: dy * plan.speed,
      vz: dz * plan.speed,
      age,
      rotation: random() * Math.PI * 2,
    };
  }
}

/** The sprites of one shader in one scene, in one draw call. */
class SpriteBatch {
  readonly emitters = new Set<Emitter>();
  private readonly mesh: Mesh;
  private readonly matrices = new Float32Array(CAPACITY * 16);
  private readonly colors = new Float32Array(CAPACITY * 4);

  constructor(
    scene: Scene,
    name: string,
    texture: Texture,
    additive: boolean,
    private readonly tint: [number, number, number],
    private readonly fades: boolean,
  ) {
    const material = new StandardMaterial(`misc_particles:${name}`, scene);
    // Sprites are unlit: the image times its sprite colour. With lighting off the
    // diffuse term is zero, so the image reaches the screen through emissive.
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = Color3.White();
    material.diffuseTexture = texture;
    texture.hasAlpha = true;
    material.useAlphaFromDiffuseTexture = true;
    material.alphaMode = additive ? Constants.ALPHA_ADD : Constants.ALPHA_COMBINE;
    material.disableDepthWrite = true;
    material.backFaceCulling = false;
    material.needAlphaBlending = () => true;
    this.mesh = MeshBuilder.CreatePlane(`misc_particles:${name}`, { size: 2 }, scene);
    this.mesh.material = material;
    this.mesh.isPickable = false;
    this.mesh.hasVertexAlpha = true;
    this.mesh.alwaysSelectAsActiveMesh = true;
    // After the map's alpha-blended surfaces (alphaIndex 0-999), before its
    // additive ones (1000 and up): additive glass in front of a puff adds over it.
    this.mesh.alphaIndex = PARTICLE_ALPHA_INDEX;
    this.mesh.metadata = { mapOwned: true };
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
    this.mesh.thinInstanceCount = 0;
  }

  draw(camera: { m: ArrayLike<number> }, eye: { x: number; y: number; z: number }, now: number): void {
    const view = camera.m;
    let count = 0;
    for (const emitter of this.emitters) {
      const o = emitter.plan.origin;
      const near = (o.x - eye.x) ** 2 + (o.y - eye.y) ** 2 + (o.z - eye.z) ** 2 < RANGE * RANGE;
      emitter.advance(now, near);
      for (const s of emitter.sprites) {
        if (count >= CAPACITY) break;
        const look = spriteLook(emitter.plan, s.age);
        if (!look) continue;
        const size = emitter.plan.size * look.scale;
        // Camera-facing, turned by the sprite's own roll.
        const c = Math.cos(s.rotation) * size;
        const n = Math.sin(s.rotation) * size;
        const m = this.matrices;
        const i = count * 16;
        m[i] = view[0] * c + view[4] * n;
        m[i + 1] = view[1] * c + view[5] * n;
        m[i + 2] = view[2] * c + view[6] * n;
        m[i + 3] = 0;
        m[i + 4] = view[4] * c - view[0] * n;
        m[i + 5] = view[5] * c - view[1] * n;
        m[i + 6] = view[6] * c - view[2] * n;
        m[i + 7] = 0;
        m[i + 8] = view[8];
        m[i + 9] = view[9];
        m[i + 10] = view[10];
        m[i + 11] = 0;
        m[i + 12] = s.x;
        m[i + 13] = s.y;
        m[i + 14] = s.z;
        m[i + 15] = 1;
        const k = count * 4;
        this.colors[k] = this.tint[0];
        this.colors[k + 1] = this.tint[1];
        this.colors[k + 2] = this.tint[2];
        this.colors[k + 3] = this.fades ? look.alpha : 1;
        count++;
      }
    }
    this.mesh.thinInstanceCount = count;
    if (count > 0) {
      this.mesh.thinInstanceBufferUpdated("matrix");
      this.mesh.thinInstanceBufferUpdated("color");
    }
  }

  dispose(): void {
    this.mesh.material?.dispose(false, false);
    this.mesh.dispose();
  }
}

/** Shader stage colour: `rgbGen const` as authored (0-1 or 0-255), else white. */
function stageTint(stage: Q3ShaderStage | undefined): [number, number, number] {
  const color = stage?.rgbGen?.type === "const" ? stage.rgbGen.color : undefined;
  if (!color) return [1, 1, 1];
  const scale = color.some((v) => v > 1) ? 1 / 255 : 1;
  return [color[0] * scale, color[1] * scale, color[2] * scale];
}

class ParticleField {
  private readonly batches = new Map<string, Promise<SpriteBatch | null>>();
  /** Drawn batches, by the key they were made under. */
  private readonly live = new Map<SpriteBatch, string>();

  constructor(private readonly scene: Scene) {
    const observer = scene.onBeforeRenderObservable.add(() => this.update());
    scene.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(observer));
  }

  batch(shader: string): Promise<SpriteBatch | null> {
    const key = shader.toLowerCase();
    let batch = this.batches.get(key);
    if (!batch) {
      batch = this.create(shader);
      this.batches.set(key, batch);
    }
    return batch;
  }

  release(batch: SpriteBatch, emitter: Emitter): void {
    batch.emitters.delete(emitter);
    if (batch.emitters.size > 0) return;
    // The last emitter of a shader went with its map: free the draw call too.
    const key = this.live.get(batch);
    if (key !== undefined) this.batches.delete(key);
    this.live.delete(batch);
    batch.dispose();
  }

  private async create(shader: string): Promise<SpriteBatch | null> {
    await Q3ShaderRegistry.getInstance().loadShaders();
    const definition = Q3ShaderRegistry.getInstance().getShader(shader);
    const stage = definition?.stages.find((s) => s.map && !s.map.startsWith("$"));
    const path = stage?.map ?? shader;
    const textures = PK3TextureLoader.getInstance();
    textures.init(this.scene.getEngine(), this.scene);
    // Shaders name the source image; packages ship it as WebP or a KTX2 sidecar.
    const texture = await textures.resolveAndLoadTexture(path);
    if (!texture || this.scene.isDisposed) {
      console.warn(`[MapParticles] No image for particle shader ${shader}`);
      return null;
    }
    const blend = stage?.blendFunc;
    const additive = !!blend && blend[0] === "GL_ONE" && blend[1] === "GL_ONE";
    const fades = !stage?.alphaGen || stage.alphaGen.type === "vertex";
    const batch = new SpriteBatch(this.scene, shader, texture, additive, stageTint(stage), fades);
    this.live.set(batch, shader.toLowerCase());
    return batch;
  }

  private update(): void {
    if (this.live.size === 0) return;
    const camera = this.scene.activeCameras?.[0] ?? this.scene.activeCamera;
    if (!camera) return;
    const world = camera.getWorldMatrix();
    const eye = camera.globalPosition;
    const now = presentationNow();
    for (const batch of this.live.keys()) batch.draw(world, eye, now);
  }
}

const fields = new WeakMap<Scene, ParticleField>();

/** Start a `misc_particles` emitter; its node's disposal stops it. */
export async function startMapParticles(entity: EntityData, scene: Scene): Promise<TransformNode | null> {
  const plan = particlePlan(entity);
  if (!plan) return null;
  let field = fields.get(scene);
  if (!field) {
    field = new ParticleField(scene);
    fields.set(scene, field);
  }
  const node = new TransformNode(`misc_particles:${plan.shader}`, scene);
  node.position.set(plan.origin.x, plan.origin.y, plan.origin.z);
  node.metadata = { mapOwned: true, entityType: "misc_particles" };
  const owner = field;
  const batch = await owner.batch(plan.shader);
  // The map may have gone while the image loaded; then there is nothing to start.
  if (!batch || node.isDisposed()) {
    node.dispose();
    return null;
  }
  const emitter = new Emitter(plan, presentationNow());
  batch.emitters.add(emitter);
  node.onDisposeObservable.addOnce(() => owner.release(batch, emitter));
  return node;
}
