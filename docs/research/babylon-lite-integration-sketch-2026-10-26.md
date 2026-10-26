# Babylon Lite integration sketch: owners, pseudocode and file changes

Date: October 26, 2026. Status: design pseudocode, not an implementation.
Read the [API coverage audit](babylon-lite-api-coverage-2026-10-26.md) first.
The [migration map](babylon-lite-migration-map-2026-10-25.md) describes feature
scope, and the [groundwork catalog](babylon-lite-groundwork-catalog-2026-10-26.md)
describes smaller extractions. This sketch connects them into an application.

The [native performance study](babylon-lite-native-performance-2026-10-26.md)
adds optional specialized implementations behind these owners: explicit draw
sets, rigid pools, custom effect payloads, selective VAT and analytic map shader
stages. Its experiments preserve this sketch's correctness/lifetime gates;
their existence is not evidence that the integration is complete.

**The plan is not complete.** In particular, material composition, independent
rig instances and safe cancellation of native builds remain unresolved. The
pseudocode makes those boundaries explicit; it does not solve them by naming
an adapter. No classes, selector, package dependency or runtime file below has
been created as part of this research.

## Conventions and target

Target for this sketch: published native `@babylonjs/lite@1.36.0`, rather than
mixing later master APIs with the published compatibility preview. Existing
WebGL and Babylon WebGPU remain unchanged defaults for the 1.0 application.
The first experiment remains an isolated static viewer, when authorized.

`Native.*` below means an actual published Lite export confirmed by declaration
and runtime-entry inspection. All other named classes/types/functions in the
sketch are **proposed SHAG code**, unless identified as existing. Code blocks
are intentionally incomplete pseudocode and cannot be pasted in as a working
renderer. Constructors, error types, data contracts and omitted algorithms need
the design records and checks described here.

Keep native handles private. Share virtual asset identities, arrays and numeric
decisions, not `BabylonMesh | LiteMesh` unions or casts to `AbstractEngine`.
Use the existing approved geometry/format data contracts when extracted; do not
create a duplicate `rendering/contracts/GeometryData` and `loader/bsp/data`
representation just because both appeared in possible folder sketches.

## 1. Browser composition chooses the whole runtime

Proposed eventual FPS file: `client/renderer-entry.ts`. Modify FPS
`browser.json` to point to it only after integrated Lite startup is accepted.
Keep `client/main.ts` self-starting and unmodified for the classic route.
Its current footer already invokes `main().catch(...)`.

```text
// PSEUDOCODE: FPS-owned selector; no engine/loader/game barrels imported here.
async function selectRuntime() {
  const choice = readRendererChoice();       // proposed; default is classic
  if (choice === "lite-experimental") {
    const app = await import("./presentation/lite/main");
    await app.startLiteApplication();         // proposed FPS entry
  } else {
    await import("./main");                  // EXISTING self-starting classic entry
  }
}

selectRuntime().catch(showSmallBootFailure);  // proposed DOM-only failure UI
```

Do not add `lite` to `RenderingBackend` and return a native engine from
`RenderingEngineFactory`. That factory's result, diagnostics, canvas recovery
and scene creation are Babylon-specific. `r_webgpu` continues to mean the
existing Babylon WebGPU route. A new preference/experimental option needs its
own semantics, supported-feature report and persistence decision.

No automatic fallback after network admission. An initialization failure before
admission may offer a clean classic restart with a fresh canvas/session. After
admission, disconnect/return/retry policy must first settle that game's seat
and state. Importing classic startup again is not a safe fallback handler.

For the first static experiment, none of these existing FPS files changes:
its separate `experiments/babylon-lite/` HTML/config owns the research entry.
The root `scripts/browser-application.ts` already selects application entries;
it does not need an engine-specific Lite alias. A root-wide compat resolver
plugin would undermine the isolation we are trying to establish.

## 2. Indexed bytes are shared; GPU objects are not

Proposed `experiments/babylon-lite/src/AssetBridge.ts`; later perhaps a generic
engine asset source if a second consumer proves the contract.

```text
class IndexedAssetSource {                    // proposed, not another downloader
  async readRequired(path, epoch) {
    epoch.checkCurrent();
    await existingPK3Index.ensureIndex();     // EXISTING deep-imported singleton
    const owner = existingPK3Index.findFile(normalizeVirtualPath(path));
    if (!owner) throw MissingIndexedAsset(path);

    await existingPK3Loader.ensurePK3(owner);  // EXISTING shared acquisition
    epoch.checkCurrent();
    const bytes = await existingPK3Loader.getFile(normalizeVirtualPath(path));
    if (!bytes) throw IndexedPackageEntryMissing(owner, path);
    epoch.checkCurrent();
    return { path, ownerRevision: resolveRevision(owner), bytes }; // proposed ID
  }
}
```

The existing PK3 methods shown take no epoch/AbortSignal argument; do not invent
one in callers. Epoch checks prevent stale attachment while shared downloads
remain owned by the acquisition system. Production scopes/mount precedence,
mirrors, integrity identity and background/foreground sharing must stay in the
existing package system. Loading can be parallelized through its bounded jobs;
do not start a second raw-fetch cache behind this bridge.

`loader/model/ModelAsset.ts` already offers `readIndexedModelAsset`. Its
`resolveModelAsset` result is shaped for Babylon ImportMesh options; reuse the
byte reader or generic package modules, not those loader options in Lite.
Required indexed assets fail clearly; they do not automatically become loose
`/data/models/...` probes. Optional indexed sidecars keep their known-absent
semantics. Custom external URLs are an explicit separate input policy.

Native `loadGltf(engine, bytes)` accepts ArrayBuffer. Validate that the selected
GLBs embed their buffer/image dependencies (the packaged player recipe already
requires that). The loader also accepts URL sources and can fetch external
resources; that does not enforce PK3 resolution or SHAG request deadlines.
External references must be rejected for the first fixture, or routed through
a separately proved resolver. Do not claim network cancellation from an API
whose public signature does not take a signal.

Texture decode consumes the same indexed source/sidecar identity. Native
`loadTexture2D` is URL-shaped; where a Blob URL or decoded pixels are needed,
the bridge must own revocation and byte lifetime through completion. Canonical
PK3 content stays untouched. Configure any native KTX2 decoder assets locally;
`setKtx2DecoderUrl` is a configuration hook, not the existing timeout/retry
guarantee from `KTX2DecoderRuntime`.

## 3. One session and one frame owner

Proposed engine file: `rendering/lite/LiteRendererSession.ts`, initially
research-local. Responsibilities: engine/surface, scene, subscriptions, one
frame driver, status, load epoch, and retirement. It does not own game rules.

```text
class LiteRendererSession {
  phase = "new";                             // new/building/ready/failed/retiring/disposed
  frame = null;
  generation = 0;
  nativeWork = new PendingNativeWorkOwner();  // proposed; unresolved contract below
  resources = new LiteResources();           // proposed, renderer-private
  releaseHooks = [];

  static async open(canvas, reportFailure) {
    const session = new LiteRendererSession();
    session.reportFailure = reportFailure;
    try {
      session.engine = await Native.createEngine(canvas);
      session.scene = Native.createSceneContext(session.engine);
      // Retain each disposer immediately, even if a later subscription throws.
      session.releaseHooks.push(Native.onEngineGpuError(session.engine, error => session.fail(error)));
      session.releaseHooks.push(Native.onEngineDeviceLost(session.engine, info => session.fail(info)));
      session.releaseHooks.push(Native.enableSurfaceResizeObserver(session.engine));
      return session;
    } catch (error) {
      await session.retirePartialInitialization(error); // proposed; handles absent scene/engine
      throw error;
    }
  }

  async build(worldPlan, epoch) {
    this.phase = "building";
    await this.worldBuilder.attach(worldPlan, this.scene, epoch);
    epoch.checkCurrent();
    await this.nativeWork.awaitOrQuarantine(
      Native.registerScene(this.scene), epoch, "scene pipelines/tasks"
    );
    epoch.checkCurrent();
    await this.preparation.verifyRequiredVariantsAndFirstFrame(epoch);
    epoch.checkCurrent();
    this.phase = "ready";
  }

  tick(presentationFrame) {
    if (this.phase !== "ready") return;
    this.presentation.applyFrame(presentationFrame);  // once, before all GPU passes
    Native.renderFrame(this.engine, presentationFrame.deltaMs);
  }

  fail(reason) {
    if (this.phase === "disposed" || this.phase === "retiring") return;
    this.phase = "failed";
    this.stopHostFrameDriver();              // proposed; prevent another tick
    this.invalidateCurrentEpoch();           // proposed; reject stale attachment
    this.reportFailure(reason);
  }

  async dispose() {
    this.phase = "retiring";
    this.stopHostFrameDriver();
    this.invalidateCurrentEpoch();
    for (const release of this.releaseHooks.splice(0)) release();
    await this.nativeWork.settleOwnedRetirements(); // NOT a proven cancellation API
    if (this.scene) Native.disposeScene(this.scene);
    await this.resources.retireUnattachedAndExternalResources();
    if (this.engine) Native.disposeEngine(this.engine);
    this.phase = "disposed";
  }
}
```

This lifecycle pseudocode exposes an unfinished part of the plan:
`PendingNativeWorkOwner` must not be implemented as just `Promise.race` and a
boolean. Native loads/builds may still be running after abort/timeout. The
owner must track the underlying promise, avoid concurrent disposal/reuse of
its target, and release late products. It needs a bounded failure policy when
work never settles; `settleOwnedRetirements` cannot become another permanent
loading-screen wait. Determine whether the tested native operation can safely
finish into a quarantined scene or requires tearing down the whole session.
The code above is not an assertion that disposal is already safe or bounded.
The same stale-result policy must cover `createEngine` during initial canvas/
device acquisition, not just later GLB loads and scene registration. Partial
initialization needs immediate ownership of every successfully created resource.

Native GPU/device subscriptions and resize observer return disposers.
`onBeforeRender` returns void, so if used, register one callback per scene,
guard it with the session generation and rely on verified scene disposal for
release. Do not use multiple per-pass before-render hooks for game updates.

Choose either native `startEngine` or a host rAF calling `renderFrame`; the
sketch chooses the latter to make input/presentation ownership explicit. Never
run both. A host frame has the following planned order:

```text
capture one frame timestamp/clock discontinuity
input.beginFrame()                     // proposed G10 seam; not per GPU pass
try:
    game/simulation consumes input according to its existing tick rules
    followed subject + demo/live presentation frame are resolved once
    presentation updates transforms, animation and effects once
    Native.renderFrame(engine, deltaMs)
finally:
    input.endFrame()                   // after consumers; policy for failed frames explicit
```

Do not silently resample network commands per render task. Physics tick and
render-frame cadences remain distinct. Native animation manager auto-ticking
versus explicit demo sampling also requires a single-owner decision; do not
advance a group both from the native loop and the demo playhead.

## 4. Load transactions and readiness products

Proposed `LoadScope`/later `LitePreparation.ts`:

```text
class LiteLoadTransaction {
  async run(mapId) {
    const epoch = this.session.beginLoad();      // proposed exclusive generation
    const hold = this.overlay.hold(epoch.id);   // proposed adapter to existing UI policy
    try {
      const source = await this.assets.readMapAndDependencies(mapId, epoch);
      const worldPlan = this.cpuWorld.describe(source); // existing parser + approved helpers
      const required = this.features.plan(worldPlan);
      this.features.rejectUnimplementedRequiredFeatures(required);
      await this.features.enableNativePrerequisites(required); // before pipeline construction
      await this.session.build(worldPlan, epoch);
      epoch.checkCurrent();
      this.commitPresentation(epoch);          // collision/admission separate for full client
      hold.releaseSuccess();                   // only this operation's hold
    } catch (error) {
      this.session.failLoad(epoch, error);      // failure UI retains a retry/exit path
      hold.releaseFailure(error);              // not permission to show an unready world
      throw error;
    }
  }
}
```

The overlay API here is proposed pseudocode, not existing method names. Full
integration must preserve `MatchMapLoader` operation-owned holds, sound muting,
required held-weapon preload and foreground package scope. A static viewer
does not need network admission or FPS post-load holds.

Readiness ledger: indexed bytes resolved; CPU data validated; required decoded
textures available; geometry/material uploads owned; feature modules enabled;
actual world/held/effect pipeline variants prepared; graph built; one valid
frame observed; final generation/visibility/device checks. No compat readiness
flag or arbitrary elapsed timeout replaces a mandatory stage. Optional features
can be omitted only under an explicit supported-feature policy.

`waitForGpuIdle` may help a bounded first-load verification checkpoint; it must
not run every frame. Hidden-tab elapsed time, overall deadline, active-time GPU
deadline and native work cancellation are different policies. The tested
application must also handle context loss during warmup and a retry after a
late rejection, without releasing another operation's loading hold.

## 5. Surface compiler and world builder

Proposed `LiteMaterialFactory.ts` (or smaller research-local functions):

```text
class LiteSurfaceCompiler {
  plan(resolvedQ3Surface, geometryLayout, quality, capabilities) {
    // Pure proposed plan: stable feature key and unsupported reasons.
    // Existing Q3ShaderRegistry remains the parser/resolver.
    if (requiresLayeredDeluxeGloss(resolvedQ3Surface))
      return unresolved("layered-lighting strategy", relevantSurfaceId);
    return describeSurfacePasses(resolvedQ3Surface, geometryLayout, quality);
  }

  async create(plan, epoch) {
    this.rejectUnresolved(plan);
    const leases = await this.textures.acquireIndexedInputs(plan, epoch);
    // Proposed per-family implementation selected only from audited support.
    const material = this.familyBuilders[plan.family].create(plan, leases);
    this.resources.trackMaterialOwnership(material, leases, epoch);
    return material;
  }
}

class LiteWorldBuilder {
  async attach(worldPlan, scene, epoch) {
    for (const part of worldPlan.spatialMaterialPartitions) {
      epoch.checkCurrent();
      const material = await this.surfaceCompiler.create(part.surface, epoch);
      const mesh = Native.createMeshFromData(
        this.engine, part.id, part.positions, part.normals, part.indices,
        part.uv, part.lightmapUv, part.tangents, part.colors
      );
      this.resources.ownUnattachedMesh(mesh, epoch); // own immediately, before next await
      mesh.material = material;
      Native.addToScene(scene, mesh);
      this.resources.markSceneOwned(mesh, scene);   // avoid duplicate disposal
      this.visibility.register(part.id, part.clusters, mesh);
    }
  }
}
```

Use typed arrays accepted by the published signature (`Uint32Array` indices
for this constructor). Preserve existing partition choices and layer encoding;
do not flatten all BSP faces into one material or expand every face into a draw.
Transparent stages need authored order and separate pass/membership decisions.
`unresolved(...)` is a deliberate design stop: do not hide an incomplete deluxe
shader behind a material that happens to compile.

Texture/material keys must include virtual revision, intended color/data use,
reduction/orientation/UV wrapper state and feature key where relevant. Decode
data can be shared; wrappers with different UV animation cannot be blindly
shared. Only copy where ownership requires it; preserve existing dirty ranges.
Renderer-native automatic resource references and SHAG leases need one
documented accounting model, not two competing reference counts.

## 6. World/weapon/depth passes and custom effects

Proposed `LiteWorldPass`, `LiteWeaponPass`, `LiteDepthSource` and
`LiteEffectBatches`, only after their ownership is proved:

```text
worldTask = Native.createRenderTask({
  name: "world", rt: worldColor, depth: ownedWorldDepth,
  cam: worldCamera, autoMirror: false
}, engine, scene);

weaponTask = Native.createRenderTask({
  name: "held-view", rt: composedColor,
  cam: weaponCamera, autoMirror: false
  // depth ownership selected from the proven held-view design, not inherited accidentally
}, engine, scene);

Native.addTask(Native.getFrameGraph(scene), worldTask);
Native.addTask(Native.getFrameGraph(scene), weaponTask);
// Proposed builders populate explicit mesh membership and the products between them.
```

Do not add these to a default world task and draw twice. A real multi-pass
session would deliberately use `createSceneContext(engine, {defaultRenderTask:false})`
and build the complete supported topology. The simplified block omits required
targets, resolves, task inputs and final canvas composition on purpose.

Published task fields include per-pass camera, shared render targets, resolve
target and separate depth. `sharedRt` is not permission for both tasks to free
an attachment; eager versus task-managed depth has specific ownership rules.
Every product must document producer, camera/projection, size, format, samples,
load/clear behavior, resize owner and sampling lifetime. World sampled depth
must never be the attachment currently being written by the sampling pass.
Linear view-Z and native reverse-Z are different products. Held FOV must not
reuse world depth as if it came from that projection.

A candidate raw effect batch has this planned interface:

```text
class LiteBeamBatch {
  reserve(capacity) {
    // CPU profiles/geometry already shared. Fixed GPU buffers and instance layout.
    this.shader = Native.createRenderShader(engine, {
      renderSource: nativeBeamWGSL,
      vertexBuffers: [beamVertexLayout, beamInstancePayloadLayout], // explicit instance step mode
      bindings: nativeBeamBindingDeclarations,
      target: equivalentAuthoredBlendState,
      depth: provenWorldDepthState
    });
    // Native.createStorageBuffer(..., {vertex:true}), createRenderBindingSet,
    // createRenderDraw and a createRenderDrawTask own actual binding/draw setup.
  }
  update(frame, eventCommands) {
    this.pool.applyOnce(eventCommands, frame.discontinuityId);
    this.pool.sampleAt(frame.timeSeconds);       // preserve seeds/lifetimes
    Native.updateStorageBufferRange(engine, this.payload, this.dirtyBytes, this.dirtyOffset);
    Native.setRenderDrawCount(this.draw, this.verticesPerBeam, this.pool.activeCount);
  }
}
```

This is an alternative to high-level thin-instance storage payloads, not an
implemented optimization. It must prove slot compaction/stable IDs, multiple
beams/impacts, transparent order, depth, view membership, upload volume and
resource retirement. A low-level draw task will not acquire PVS/frustum/lighting
policy automatically. Its shaders must consume the right camera for each task.

No `removeTask` or `createCustomPostProcessTask` call appears here because those
later-source exports are absent from the chosen published package. A fixed
graph plus execution gates is the conservative design starting point. Graph
rebuilding, custom effect-wrapper postpasses and removal/disposal require their
own lifecycle fixtures before editing live quality settings mid-session.

## 7. Actors and game presentation: intentionally unfinished seams

Proposed engine `LiteModelLibrary`/`LiteRig` and FPS
`client/presentation/lite/FpsLitePresentation.ts`:

```text
class LiteModelLibrary {
  async createActor(modelId, epoch) {
    const source = await this.assets.readEmbeddedModel(modelId, epoch);
    return this.actorFactory.createIndependentRig(source, epoch);
    // BLOCKED DESIGN: independent skin, clip retargeting and attachment handles
    // must be proved. cloneTransformNode alone does not establish that contract.
  }
}

class FpsLitePresentation {
  commitSnapshot(committedGameState, frameContext) {
    // proposed inputs from ONE existing state/POV owner, not another network listener
    this.subject = frameContext.followedSubject;
    this.actors.reconcile(committedGameState.players);
    this.weapons.commitLastingState(committedGameState, this.subject);
    this.combat.consumeNewEvents(committedGameState.events, frameContext.eventPolicy);
  }
  applyFrame(frameContext) {
    this.actors.samplePose(frameContext);       // native animation manager ownership explicit
    this.heldWeapon.sample(frameContext, this.subject);
    this.effects.sample(frameContext);
    this.camera.applyNumericPose(frameContext.cameraPose);
  }
  discontinuity(frameContext) {
    this.effects.clearTransientState();
    this.weapons.reconstruct(frameContext);    // preserve ADS/beam lasting state
    this.actors.reconstruct(frameContext);
  }
}
```

These inputs do not exist as a complete neutral FPS composition today.
`Game.onServerStateUpdate` stores lasting state first, then performs subject/
spectator work and concrete `GameEvents` dispatch. It must retain that ordering
if an adapter is introduced. Existing `Game`, `FrameEffects`, `ServerProjectiles`,
model caches and `WeaponViewManager` cannot just be passed a native scene.

Before an integrated client, decide the smallest shared state/presentation
coordinator seam and test it using the classic sink. That seam is game-owned;
engine code must never import FPS. Demo seeks suppress one-shots while restoring
lasting ADS/beam/weapon state, and target switching uses the same subject owner.
Native `goToFrame` applies a pose and pauses; its resume/auto-tick interaction
must be adapted deliberately. No Babylon `_goToFrame` private patch is copied.

Independent actor/rig creation is a major open decision, not a task hidden
inside the proposed `actorFactory`. Prove two independent animated actors,
retargeted clip assets and attachments, then one-actor disposal. Choose a
public upstream extension or bounded adapter if the required factory is absent.

## 8. Exact proposed file impact, by milestone

All modifications below are future proposals, not changes made in this round.
Paths labeled FPS belong to the game repository.

| Milestone | Existing files that would change | Additions / reason |
| --- | --- | --- |
| Isolated static viewer | None of `src/`, root dependencies, FPS bootstrap or canonical media | Research-local package/lock/config/HTML plus AssetBridge, session, world/material case files; actual count can be smaller than the architecture sketch |
| Small shared groundwork | Only owners in the approved extraction patch: e.g. `AmmoCounterDisplay.ts`, `TagsLoader.ts`, `mesh/coordinates.ts`, `ColorCorrectionPostProcess.ts` | Pure modules from the groundwork catalog; old API re-export/wrapper, tests and docs in the same patch |
| Shared world query/data seams | `PVSCuller.ts`, selected `bsp/mesh` helpers and possibly `ShaderAnimationSystem.ts`; MD3 only if selected content needs it | Data/query/evaluation modules; existing classic callers consume the same logic. No scene-object result reshaping by stealth |
| Accepted engine Lite library | No need to relocate classic renderer files | Add `rendering/lite` owners that proved useful in the isolated viewer; decide package version/build ownership before adding the dependency |
| FPS backend selector | FPS `browser.json`; preserve FPS `client/main.ts` as default | FPS `client/renderer-entry.ts` and `client/presentation/lite/main.ts`; keep startup imports separated |
| Integrated map/join flow | FPS `client/MatchMapLoader.ts`, game composition in `Game.ts`; possible selected loader hook in engine `loader/map/ClientMapLoader.ts` only after exact contract design | Selected loader/preparation destination preserves package scope, admission, collision/trigger data, loading holds and failure recovery |
| Snapshot/effect/POV integration | FPS `Game.ts`, `client/GameEvents.ts`, `FrameEffects.ts`, `ServerProjectiles.ts`, followed-view/demo composition as needed | Game-owned state/subject/clock adapter, then Lite sinks. Existing `RemotePlayerRenderer` remains classic; do not rewrite it wholesale for native handles |
| Input/settings host integration | Engine `InputSystem.ts`, `CameraInputHandler.ts`, `RenderVars.ts` only in approved G10-G12 patches | Explicit frame host, numeric aim and settings definitions; preserve existing init/setup and saved values |
| Animation/rig integration | Engine `PlayerModelManager.ts`/rig/blending owners only if a tested shared seam is necessary | Lite-specific actor binding and game recipe mapping; preserve classic state semantics/private fixes within classic files |
| Full gameplay parity | Selected remaining presentation owners after separate feature review | Lighting, water, particles, outlines, audio host and physics adapter milestones. Static viewer completion does not authorize this scope |

`RenderingEngineFactory.ts`, `BrowserRuntime.ts`, `EngineServices.ts`,
`ServiceLocator.ts`, current material plugins, `GpuPreparation.ts`,
`ModelInstanceCache.ts` and existing weapon/world GPU caches should remain
classic implementations. No invisible classic scene is a default Lite asset
parser or physics workaround. A later physics decision must make all scene/body
ownership explicit and preserve authoritative simulation behavior.

Root Vite/app-selection scripts need no Lite rewrite for the isolated harness.
Production deploy/start scripts, lobby/server/bot code, protocol, demo file
format and `public/data` need no change for that milestone. A later package or
application-manifest change goes through matching `staging` branches and the
normal approval process before `main`, which auto-deploys.

## 9. Evidence acquisition and validation

Acquire the pinned package evidence without `npm install` (PowerShell, root):

```powershell
$researchRoot = Join-Path (Get-Location) '.cache/babylon-lite-research/published-api'
New-Item -ItemType Directory -Path $researchRoot -Force | Out-Null
$packages = @(@{slug='lite';name='@babylonjs/lite';version='1.36.0'}, @{slug='compat';name='@babylonjs/lite-compat';version='1.36.0-preview'})
foreach ($package in $packages) {
  $metadata = Invoke-RestMethod -Uri ('https://registry.npmjs.org/' + $package.name + '/' + $package.version)
  $metadata | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $researchRoot ($package.slug + '-metadata.json')) -Encoding utf8
  Invoke-WebRequest -Uri $metadata.dist.tarball -OutFile (Join-Path $researchRoot ($package.slug + '.tgz'))
  New-Item -ItemType Directory -Path (Join-Path $researchRoot $package.slug) -Force | Out-Null
  tar -xf (Join-Path $researchRoot ($package.slug + '.tgz')) -C (Join-Path $researchRoot $package.slug)
  if ($LASTEXITCODE -ne 0) { throw 'Research archive extraction failed' }
}
node docs/research/babylon-lite-evidence/audit-published-api.mjs
```

The audit checks downloaded archive integrity and declaration/runtime export
probes; it reads application source, not executes it. The selected symbols are
explicitly probes, not a frozen required feature list or a compatibility gate.
Pseudocode identifiers without `Native.` are proposed application contracts.

Required checks for this research pass: script syntax, reproducible evidence
including source hashes and package integrity, local research links/fences,
`npm.cmd run docs:build`, and Biome baseline. No native/compat module execution,
GPU test, dependency installation or runtime refactor is part of this pass.

Before implementation, turn the unresolved pieces into design decisions and
fixtures. Before a supported game renderer, prove actual material/actor/pass
parity, repeated load/dispose, failure recovery and matched performance. A
pseudocode class with an unresolved method is useful documentation of remaining
work; it is not evidence that the method can be implemented cheaply.
