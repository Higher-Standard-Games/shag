/**
 * ModelSourceCache (NullEngine). The scene clear before every client map load
 * disposes all meshes with their materials, and a map unload disposes cached
 * textures. Caches that kept handing out such sources produced invisible or
 * untextured weapons and projectiles from the second join of a page load on.
 */

import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeModelResources, isTextureReleased, ModelSourceCache } from "../ModelSourceCache";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  engine.dispose();
  vi.restoreAllMocks();
});

function texture(): RawTexture {
  return RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
}

/** A disabled, textured source like a preloaded weapon. */
function source() {
  const root = new TransformNode("rlauncher_root", scene);
  const material = new StandardMaterial("rlauncher", scene);
  const diffuse = texture();
  material.diffuseTexture = diffuse;
  const mesh = MeshBuilder.CreateBox("stock_cover_lp", { size: 1 }, scene);
  mesh.material = material;
  mesh.parent = root;
  mesh.setEnabled(false);
  return { model: { root, meshes: [mesh] }, mesh, material, diffuse };
}

/** A clone under its own root, as AssetPreloader.cloneCachedModel makes them. */
function cloneOf(mesh: Mesh): Mesh {
  return mesh.clone(`${mesh.name}_clone`, new TransformNode("clone_root", scene));
}

/** SceneCommand.clearScene, which loadClientMap runs when a scene already exists. */
function clearScene(): void {
  for (const mesh of [...scene.meshes]) mesh.dispose(false, true);
}

describe("ModelSourceCache", () => {
  it("hands out a source whose meshes, materials and textures are alive", () => {
    const cache = new ModelSourceCache("test");
    const { model, mesh } = source();
    cache.set("rlauncher", model);

    expect(cache.get("rlauncher")).toBe(model);
    expect(cloneOf(mesh).getTotalVertices()).toBeGreaterThan(0);
  });

  it("drops a source the scene clear disposed, so its owner loads it again", () => {
    const cache = new ModelSourceCache("test");
    const { model, mesh } = source();
    cache.set("rlauncher", model);

    clearScene();

    // What pickups, drops and projectiles used to receive.
    expect(cloneOf(mesh).getTotalVertices()).toBe(0);
    expect(cache.has("rlauncher")).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("drops a source whose texture a texture cache clear released", () => {
    const cache = new ModelSourceCache("test");
    const { model, diffuse } = source();
    cache.set("rlauncher", model);

    diffuse.dispose();

    expect(cache.get("rlauncher")).toBeUndefined();
  });

  it("drops a source whose material was disposed", () => {
    const cache = new ModelSourceCache("test");
    const { model, mesh, material } = source();
    cache.set("rlauncher", model);

    material.dispose();

    expect(mesh.material).toBeNull();
    expect(cache.get("rlauncher")).toBeUndefined();
  });

  it("keeps a source whose texture is still loading or arrives after caching", () => {
    const cache = new ModelSourceCache("test");
    const { model, material } = source();
    const loading = new Texture(null, scene);
    material.diffuseTexture = loading;
    cache.set("rlauncher", model);
    material.emissiveTexture = texture();

    expect(isTextureReleased(loading)).toBe(false);
    expect(cache.get("rlauncher")).toBe(model);
  });

  it("ignores a texture that was already released when cached, but not a later release", () => {
    const cache = new ModelSourceCache("test");
    const { model, material, diffuse } = source();
    const dead = texture();
    dead.dispose();
    material.emissiveTexture = dead;
    cache.set("rlauncher", model);

    expect(cache.get("rlauncher")).toBe(model);
    expect(cache.get("rlauncher")).toBe(model);

    diffuse.dispose();
    expect(cache.get("rlauncher")).toBeUndefined();
  });

  it("keeps what a live clone still renders with when an entry is released", () => {
    const cache = new ModelSourceCache("test");
    const { model, mesh, material, diffuse } = source();
    cache.set("rlauncher", model);
    const clone = cloneOf(mesh);

    cache.clear();

    expect(mesh.isDisposed()).toBe(true);
    expect(model.root.isDisposed()).toBe(true);
    expect(clone.isDisposed()).toBe(false);
    expect(clone.material).toBe(material);
    expect(scene.materials).toContain(material);
    expect(isTextureReleased(diffuse)).toBe(false);
  });

  it("disposes materials and textures nothing else uses when an entry is released", () => {
    const cache = new ModelSourceCache("test");
    const { model, material, diffuse } = source();
    cache.set("rlauncher", model);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(scene.materials).not.toContain(material);
    expect(isTextureReleased(diffuse)).toBe(true);
  });
});

describe("disposeModelResources", () => {
  it("keeps a texture another material still samples", () => {
    const { mesh, material, diffuse } = source();
    const other = new StandardMaterial("other", scene);
    other.diffuseTexture = diffuse;

    disposeModelResources([mesh]);

    expect(scene.materials).not.toContain(material);
    expect(isTextureReleased(diffuse)).toBe(false);
  });

  it("never releases the scene environment texture", () => {
    const { mesh, material } = source();
    const environment = texture();
    material.reflectionTexture = environment;
    scene.environmentTexture = environment;

    disposeModelResources([mesh]);

    expect(isTextureReleased(environment)).toBe(false);
  });

  it("releases animation groups, and a skeleton once no mesh is skinned by it", () => {
    const { model, mesh } = source();
    const skeleton = new Skeleton("rig", "rig", scene);
    const group = new AnimationGroup("idle", scene);
    mesh.skeleton = skeleton;
    const clone = cloneOf(mesh);
    clone.skeleton = skeleton;
    const cache = new ModelSourceCache("test");
    cache.set("rlauncher", { ...model, animationGroups: [group], skeletons: [skeleton] });

    cache.clear();
    expect(scene.animationGroups).not.toContain(group);
    expect(scene.skeletons).toContain(skeleton);

    disposeModelResources([clone]);
    expect(scene.skeletons).not.toContain(skeleton);
  });

  it("skips nodes that are missing or already disposed", () => {
    const { mesh } = source();
    mesh.dispose();

    expect(() => disposeModelResources([null, undefined, mesh])).not.toThrow();
  });
});
