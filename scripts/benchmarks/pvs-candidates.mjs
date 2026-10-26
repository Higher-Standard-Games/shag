import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openBrowser, bootGame, waitForMap, sleep } from "../../.claude/skills/browser-probe/scripts/cdp.mjs";
import { summarizeCpuProfile } from "./cpu-profile.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const backend = process.argv[2] ?? "webgl2",
  mode = process.argv[3] ?? "fixture",
  port = Number(process.argv[4] ?? 3121);
if (
  !["webgl2", "webgpu"].includes(backend) ||
  !["fixture", "live"].includes(mode) ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
)
  throw new Error("usage: pvs-candidates.mjs [webgl2|webgpu] [fixture|live] [port]");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
function identity() {
  const hash = createHash("sha256").update(git("diff", "--binary", "HEAD", "--", "src"));
  for (const file of git("ls-files", "--others", "--exclude-standard", "src")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .sort())
    hash.update(file).update(fs.readFileSync(file));
  return {
    head: git("rev-parse", "HEAD").trim(),
    sourceSha256: hash.digest("hex"),
    dirty: git("status", "--short").trim(),
  };
}
const start = identity();
const b = await openBrowser({ width: 960, height: 540 });
const cache = ".cache/renderer-groundwork";
fs.mkdirSync(cache, { recursive: true });
let result;
try {
  if (mode === "fixture") {
    await b.send("Page.navigate", { url: `http://127.0.0.1:${port}/engine.json` });
    await sleep(500);
    result = await b.ev(
      `import('/src/engine/rendering/__qa__/PvsCandidatesFixture.ts').then(m=>m.runPvsCandidatesFixture(${JSON.stringify(backend)}))`,
    );
  } else {
    await bootGame(b, `http://127.0.0.1:${port}/?renderer=${backend}`);
    await b.command("demo washoi_dm5_ffa_20261025_170933.shagdemo");
    void b.command("demoplay");
    await waitForMap(b, 120);
    await sleep(2000);
    const setup = await b.ev(`(async()=>{
   const {BspManager}=await import('/src/engine/loader/bsp/BspManager.ts');
   const {DemoService}=await import('/src/games/fps/client/DemoService.ts');
   const {createLivePvsProbe}=await import('/src/engine/rendering/__qa__/PvsCandidatesFixture.ts');
   const {getSinglePvsCamera}=await import('/src/engine/rendering/PvsMeshCandidates.ts');
   const scene=window.scene,manager=BspManager.getInstance(),culler=manager.getPVSCuller();
   if(!culler?.isEnabled())throw new Error('Live PVS is not active');
   DemoService.getInstance().activeDemoViewer?.pause();
   manager.pvsCandidateCleanup?.();
   window.pvsProbe=createLivePvsProbe(scene,culler);
   return {backend:scene.getEngine().isWebGPU?'webgpu':'webgl2',map:manager.getState().mapName,sceneMeshes:scene.meshes.length,camera:getSinglePvsCamera(scene)?.name};
  })()`);
    if (!setup || typeof setup !== "object" || setup.backend !== backend)
      throw new Error(`Live setup failed: ${JSON.stringify(setup)}`);
    const before = await b.ev("window.pvsProbe.capture(false,120)");
    const after = await b.ev("window.pvsProbe.capture(true,120)");
    const profiles = [];
    for (const enabled of [false, true]) {
      await b.ev(`window.pvsProbe.setEnabled(${enabled})`);
      const firstFrame = await b.ev("window.scene.getFrameId()");
      await b.send("Profiler.enable");
      await b.send("Profiler.setSamplingInterval", { interval: 500 });
      await b.send("Profiler.start");
      await sleep(5000);
      const stopped = await b.send("Profiler.stop"),
        profile = stopped.result?.profile;
      const lastFrame = await b.ev("window.scene.getFrameId()");
      if (!profile) throw new Error("Missing CPU profile");
      fs.writeFileSync(
        `${cache}/pvs-${backend}-${enabled ? "pruned" : "reference"}.cpuprofile`,
        JSON.stringify(profile),
      );
      const summary = summarizeCpuProfile(profile, lastFrame - firstFrame);
      profiles.push({
        enabled,
        frames: lastFrame - firstFrame,
        durationMs: summary.durationMs,
        top: summary.byInclusive.slice(0, 15),
        selection: summary.byInclusive
          .filter((f) => /evaluateActiveMeshes|isReady|preActivate|provider|bindForSubMesh|_draw/.test(f.functionName))
          .slice(0, 35),
      });
    }
    const reference = before?.counts?.[setup.camera];
    const candidate = after?.counts?.[setup.camera];
    result = {
      setup, before, after, profiles,
      passed: before?.frames === 120 && after?.frames === 120 &&
        reference?.passes === 120 && candidate?.passes === 120 &&
        reference.hiddenWorld > 0 && candidate.hiddenWorld === 0,
    };
  }
  const end = identity();
  const record = {
    backend,
    mode,
    start,
    end,
    sourceStable: start.head === end.head && start.sourceSha256 === end.sourceSha256,
    result,
    logs: b.logs,
    failed: b.failed,
  };
  fs.writeFileSync(`${cache}/pvs-candidates-${mode}-${backend}.json`, JSON.stringify(record, null, 2));
  console.log(
    JSON.stringify({ backend, mode, sourceStable: record.sourceStable, result, logs: b.logs, failed: b.failed }),
  );
  if (
    !result ||
    typeof result !== "object" ||
    result.passed !== true ||
    b.failed.length ||
    b.logs.some((line) => /error|EXCEPTION/.test(line))
  )
    process.exitCode = 1;
} catch (error) {
  fs.writeFileSync(
    `${cache}/pvs-candidates-${mode}-${backend}-error.json`,
    JSON.stringify({ error: String(error), logs: b.logs, failed: b.failed }, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.ev("window.pvsProbe?.dispose()");
  await b.close();
}
process.exit(process.exitCode ?? 0);
