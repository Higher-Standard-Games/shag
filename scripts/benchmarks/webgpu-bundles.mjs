import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installBundleProbe } from "./bundle-probe.mjs";
import { openBrowser, bootGame, waitForMap, sleep } from "../../.claude/skills/browser-probe/scripts/cdp.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const port = Number(process.argv[2] ?? 3122);
const mode = process.argv[3] ?? "default";
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !["default", "legacy-slots"].includes(mode))
  throw new Error("usage: webgpu-bundles.mjs [port] [default|legacy-slots]");
const dir = ".cache/renderer-groundwork";
fs.mkdirSync(dir, { recursive: true });
const prefix = `${dir}/webgpu-bundles-${mode}`;
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
const hash = (data) => createHash("sha256").update(data).digest("hex");
const dependencyFiles = [
  "Engines/webgpuEngine.pure.js",
  "Engines/WebGPU/webgpuDrawContext.js",
  "Engines/WebGPU/webgpuMaterialContext.js",
  "Materials/uniformBuffer.js",
  "Materials/drawWrapper.js",
];
function identity() {
  return {
    head: git("rev-parse", "HEAD").trim(),
    fpsHead: git("-C", `${root}/src/games/fps`, "rev-parse", "HEAD").trim(),
    diffHash: hash(git("diff", "--binary", "HEAD", "--", "src")),
    fpsDiffHash: hash(git("-C", `${root}/src/games/fps`, "diff", "--binary", "HEAD", "--")),
    dependencies: Object.fromEntries(
      dependencyFiles.map((name) => [name, hash(fs.readFileSync(`node_modules/@babylonjs/core/${name}`))]),
    ),
  };
}
const start = identity();
const babylonVersion = JSON.parse(fs.readFileSync("node_modules/@babylonjs/core/package.json", "utf8")).version;
const b = await openBrowser({ width: 960, height: 540 });
let result;
try {
  await bootGame(b, `http://127.0.0.1:${port}/?renderer=webgpu&ncm=1`);
  const setup = await b.ev(`(() => {
    const e=window.scene.getEngine();
    if(!e.isWebGPU || e.compatibilityMode !== false) throw new Error('Requested NCM did not activate');
    if(${JSON.stringify(mode)}==='legacy-slots') {
      if(typeof e._useOwnerKeyedUniformBufferSlots !== 'boolean') throw new Error('Local owner-slot switch absent');
      e._useOwnerKeyedUniformBufferSlots=false;
    }
    return {engineApiVersion:e.version,compatibilityMode:e.compatibilityMode,ownerSlots:e._useOwnerKeyedUniformBufferSlots ?? null,drawSource:e._draw.toString()};
  })()`);
  if (!setup || typeof setup !== "object" || setup.compatibilityMode !== false)
    throw new Error(`Setup failed: ${JSON.stringify(setup)}`);
  setup.drawSourceHash = hash(setup.drawSource);
  delete setup.drawSource;
  setup.babylonVersion = babylonVersion;
  const demo = await b.command("demo washoi_dm5_ffa_20261025_170933.shagdemo");
  if (typeof demo !== "string" || demo.startsWith("FAILED:")) throw new Error(`Demo selection: ${demo}`);
  void b.command("demoplay");
  await waitForMap(b, 120);
  await sleep(1500);
  const beforeProbeDiagnostics = {
    logs: [...b.logs],
    runtimeReport: await b.ev("window.rendererRuntimeReport ?? null"),
  };
  const install = await b.ev(`(() => {
    window.bundleProbe=(${installBundleProbe.toString()})(window.scene.getEngine(),window.scene);
    return true;
  })()`);
  if (install !== true) throw new Error(`Install failed: ${install}`);
  const phases = [];
  for (const paused of [false, true]) {
    const label = paused ? "paused" : "playing";
    if (paused) {
      const pause = await b.ev(
        `import('/src/games/fps/client/DemoService.ts').then(m=>{const v=m.DemoService.getInstance().activeDemoViewer;if(!v)throw new Error('No demo viewer');v.pause();return true;})`,
      );
      if (pause !== true) throw new Error(`Pause failed: ${pause}`);
      await sleep(2500);
    }
    const capture = await b.ev(`new Promise((resolve,reject)=>{
      const scene=window.scene,engine=scene.getEngine(),probe=window.bundleProbe;
      const metadata={mapMeshes:scene.meshes.length,camera:scene.activeCameras?.[0]?.name ?? scene.activeCamera?.name,firstFrame:engine.frameId,
        liquids:scene.meshes.filter(mesh=>mesh.metadata?.liquidKind).map(mesh=>({name:mesh.name,kind:mesh.metadata.liquidKind,occlusionType:mesh.occlusionType,isOccluded:mesh.isOccluded}))};
      let frames=0,created=0,reused=0;
      const before=scene.onBeforeRenderObservable.add(()=>{created=engine._counters.numBundleCreationNonCompatMode;reused=engine._counters.numBundleReuseNonCompatMode;});
      let engineCreated=0,engineReused=0;
      const done=()=>{clearTimeout(timeout);scene.onBeforeRenderObservable.remove(before);scene.onAfterRenderObservable.remove(after);};
      const timeout=setTimeout(()=>{done();reject(new Error('Bundle window timed out'));},20000);
      probe.begin(${JSON.stringify(label)});
      const after=scene.onAfterRenderObservable.add(()=>{
        engineCreated+=engine._counters.numBundleCreationNonCompatMode-created;
        engineReused+=engine._counters.numBundleReuseNonCompatMode-reused;
        if(++frames===180){done();resolve({...probe.finish(),frames,engineCreated,engineReused,metadata:{...metadata,lastFrame:engine.frameId}});}
      });
    })`);
    if (!capture || typeof capture !== "object" || capture.frames !== 180)
      throw new Error(`Capture failed: ${JSON.stringify(capture)}`);
    phases.push(capture);
    await b.shot(`${prefix}-${label}.png`);
  }
  const end = identity();
  const sourceStable = JSON.stringify(start) === JSON.stringify(end);
  result = {
    mode,
    start,
    end,
    sourceStable,
    setup,
    beforeProbeDiagnostics,
    phases,
    runtimeReport: await b.ev("window.rendererRuntimeReport ?? null"),
    logs: b.logs,
    failed: b.failed,
  };
  result.passed =
    sourceStable &&
    b.failed.length === 0 &&
    !result.runtimeReport?.errors?.length &&
    !b.logs.some((line) => /error:|EXCEPTION|GPUValidationError|Invalid CommandBuffer|occlusionQuerySet/.test(line)) &&
    phases.every(
      (p) =>
        p.overflow === 0 &&
        p.created === p.engineCreated &&
        p.reused === p.engineReused &&
        p.draws === p.created + p.reused + p.other &&
        p.draws > 0 &&
        p.metadata.liquids.length > 0 &&
        p.metadata.liquids.every((mesh) => mesh.occlusionType === 0 && !mesh.isOccluded),
    );
  fs.writeFileSync(`${prefix}.json`, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      passed: result.passed,
      setup,
      phases: phases.map((p) => ({ ...p, rows: p.rows.slice(0, 12) })),
      logs: b.logs,
      failed: b.failed,
    }),
  );
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  fs.writeFileSync(
    `${prefix}-error.json`,
    JSON.stringify({ error: String(error), start, logs: b.logs, failed: b.failed }, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.ev("window.bundleProbe?.dispose()");
  await b.close();
}
process.exit(process.exitCode ?? 0);
