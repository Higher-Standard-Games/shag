import assert from "node:assert/strict";
import test from "node:test";
import { installBundleProbe } from "../bundle-probe.mjs";

function setup() {
  class Context {
    constructor(manager) {
      this._bufferManager = manager;
      this.buffers = {};
      this._isDirty = false;
      this._materialContextUpdateId = 0;
      this.fastBundle = {};
    }
    setBuffer(name, buffer) {
      this._isDirty ||= this.buffers[name]?.uniqueId !== buffer?.uniqueId;
      this.buffers[name] = buffer;
    }
    reset() {
      this.buffers = {};
      this.fastBundle = undefined;
      this._isDirty = true;
    }
    isDirty(id) {
      return this._isDirty || this._materialContextUpdateId !== id;
    }
  }
  const manager = {};
  const context = new Context(manager);
  const material = { updateId: 0, isDirty: false, forceBindGroupCreation: false };
  const engine = {
    isWebGPU: true,
    compatibilityMode: false,
    _bufferManager: manager,
    _currentDrawContext: context,
    _currentMaterialContext: material,
    _counters: { numBundleCreationNonCompatMode: 0, numBundleReuseNonCompatMode: 0 },
    currentRenderPassId: 1,
    _draw() {
      // Model a UBO bind inside _draw, before the gate; entry-only sampling would miss it.
      if (this.nextBuffer) {
        context.setBuffer("LeftOver", this.nextBuffer);
        this.nextBuffer = null;
      }
      if (context.isDirty(material.updateId) || material.isDirty || material.forceBindGroupCreation)
        context.fastBundle = undefined;
      if (context.fastBundle) this._counters.numBundleReuseNonCompatMode++;
      else {
        this._counters.numBundleCreationNonCompatMode++;
        context._isDirty = false;
        context._materialContextUpdateId = material.updateId;
        material.isDirty = false;
        context.fastBundle = {};
      }
    },
  };
  const scene = { activeCamera: { name: "eye" }, meshes: [] };
  class Mesh {
    constructor() {
      this.name = "world";
    }
    getScene() {
      return scene;
    }
    _draw() {
      engine._draw();
    }
  }
  const mesh = new Mesh();
  scene.meshes.push(mesh);
  const draw = () => mesh._draw({ _id: 0, getMaterial: () => ({ name: "stone" }) });
  return { scene, engine, context, material, draw, Context, Mesh };
}

test("attributes the actual gate after UBO binding and reconciles creation/reuse", () => {
  const s = setup(),
    probe = installBundleProbe(s.engine, s.scene);
  probe.begin("moving");
  s.draw();
  s.engine.nextBuffer = { uniqueId: 12 };
  s.draw();
  s.material.updateId++;
  s.draw();
  s.context.reset();
  s.draw();
  const r = probe.finish();
  assert.equal(r.draws, 4);
  assert.equal(r.created, 3);
  assert.equal(r.reused, 1);
  assert.deepEqual(r.rows[0].bufferChanges, { LeftOver: 1 });
  assert.equal(r.rows[0].causes.drawDirty, 2);
  assert.equal(r.rows[0].causes.materialVersionChanged, 1);
  assert.equal(r.rows[0].causes["context-reset-observed"], 1);
  assert.equal(r.rows[0].causes["previously-observed-empty"], 1);
  assert.equal(r.rows[0].causes["gate-not-observed"], undefined);
  assert.equal(r.rows[0].mesh, "world");
  probe.dispose();
});

test("keeps reasons overlapping, distinguishes empty contexts and ignores foreign buffers", () => {
  const s = setup(),
    probe = installBundleProbe(s.engine, s.scene);
  probe.begin("cold");
  const foreign = new s.Context({});
  foreign.setBuffer("other", { uniqueId: 88 });
  s.context.fastBundle = undefined;
  s.material.isDirty = true;
  s.material.forceBindGroupCreation = true;
  s.draw();
  const r = probe.finish();
  assert.equal(r.rows[0].causes["first-observed-empty"], 1);
  assert.equal(r.rows[0].causes.materialDirty, 1);
  assert.equal(r.rows[0].causes.externalTexture, 1);
  assert.deepEqual(r.rows[0].bufferChanges, {});
  probe.dispose();
});

test("restores all hooks and preserves a foreign replacement", () => {
  const s = setup();
  const originals = [
    s.engine._draw,
    s.Context.prototype.isDirty,
    s.Context.prototype.setBuffer,
    s.Context.prototype.reset,
    s.Mesh.prototype._draw,
  ];
  const probe = installBundleProbe(s.engine, s.scene);
  assert.throws(() => probe.finish(), /No active/);
  probe.begin("a");
  assert.throws(() => probe.begin("b"), /already/);
  probe.finish();
  probe.dispose();
  probe.dispose();
  assert.deepEqual(
    [
      s.engine._draw,
      s.Context.prototype.isDirty,
      s.Context.prototype.setBuffer,
      s.Context.prototype.reset,
      s.Mesh.prototype._draw,
    ],
    originals,
  );
  assert.throws(() => probe.begin("c"), /disposed/);
  const another = installBundleProbe(s.engine, s.scene);
  const replacement = () => {};
  s.engine._draw = replacement;
  another.dispose();
  assert.equal(s.engine._draw, replacement);
  s.engine.compatibilityMode = true;
  assert.throws(() => installBundleProbe(s.engine, s.scene), /non-compatibility/);
});

test("restores inherited methods and rejects unsupported contexts before installing hooks", () => {
  const s = setup(),
    original = s.engine._draw;
  delete s.engine._draw;
  Object.setPrototypeOf(s.engine, { _draw: original });
  const probe = installBundleProbe(s.engine, s.scene);
  probe.begin("inherited");
  s.draw();
  assert.equal(probe.finish().reused, 1);
  probe.dispose();
  assert.equal(Object.hasOwn(s.engine, "_draw"), false);
  s.engine._currentDrawContext = null;
  assert.throws(() => installBundleProbe(s.engine, s.scene), /Unsupported/);
  assert.equal(s.engine._draw, original);
});
