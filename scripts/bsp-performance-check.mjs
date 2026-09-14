/** Run headless regressions first. Uses a disposable Chrome profile and local Vite server.
 * node scripts/bsp-performance-check.mjs --map=wbomb6
 * Optional: --cells=0,1024,2048 --rounds=3 --seconds=4 --sweep-seconds=6 --spawns=0,10,20
 * BSP_CHECK_BROWSER overrides the Chrome executable. Artifacts stay under temp/.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import WebSocket from "ws";

const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const map = option("map", "wbomb6");
if (!/^[a-zA-Z0-9_-]+$/.test(map)) throw new Error("Use a simple indexed map name");
const cells = option("cells", "0,1024,2048").split(",").map(Number);
const spawns = option("spawns", "0,10,20").split(",").map(Number);
const rounds = Number(option("rounds", "3"));
const seconds = Number(option("seconds", "4"));
const sweepSeconds = Number(option("sweep-seconds", "6"));
if (!cells.length || cells.some((v) => !Number.isInteger(v) || (v !== 0 && (v < 128 || v > 4096))) ||
    !spawns.length || spawns.some((v) => !Number.isInteger(v) || v < 0) ||
    !Number.isInteger(rounds) || rounds < 1 || rounds > 10 ||
    ![seconds, sweepSeconds].every((v) => Number.isFinite(v) && v >= 1 && v <= 30)) {
  throw new Error("Invalid benchmark arguments");
}
const output = resolve(`temp/bsp-performance-${map}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "shag-bsp-performance-"));
const flags = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--window-size=1280,720",
  "--disable-frame-rate-limit", "--disable-gpu-vsync", "about:blank"];
const server = await createServer({
  cacheDir: resolve("temp/vite-bsp-performance-cache"),
  // Fixture-only imports are outside the app's src/ dependency inventory.
  // Prebundle them before navigation to avoid a reload during map loading.
  optimizeDeps: { include: [
    "@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery",
    "@babylonjs/core/Engines/Extensions/engine.query",
  ] },
  server: { host: "127.0.0.1", port: 0, open: false },
  plugins: [{ name: "bsp-performance-fixture", configureServer(vite) {
    vite.middlewares.use("/__bsp_performance", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><head><link rel="icon" href="data:,"></head><body style="margin:0;overflow:hidden"><canvas width="1280" height="720" style="width:1280px;height:720px"></canvas><script type="module" src="/scripts/bsp-performance-scene.ts"></script></body></html>');
    });
  } }],
});
const results = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(),
  map, cells, spawns, rounds, seconds, sweepSeconds, flags, output,
  fixture: "MapLoader + default post-processing + world/empty weapon cameras; no full client simulation",
  runs: [], diagnostics: [],
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child, ws;
const save = () => writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
try {
  await server.listen();
  const port = server.httpServer.address().port;
  child = spawn(process.env.BSP_CHECK_BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", flags,
    { windowsHide: true, stdio: "ignore" });
  let spawnError;
  child.on("error", (error) => { spawnError = error; });
  let debugPort;
  for (let i = 0; i < 150; i++) {
    if (spawnError) throw spawnError;
    try { debugPort = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch {}
    if (debugPort) break;
    await delay(100);
  }
  if (!debugPort) throw new Error("Chrome did not expose its disposable debugging endpoint");
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = pages.find((p) => p.type === "page");
  if (!page) throw new Error("Chrome has no page target");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  let id = 0;
  const pending = new Map();
  ws.on("message", (bytes) => {
    const message = JSON.parse(bytes);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    if (["Runtime.exceptionThrown", "Log.entryAdded", "Runtime.consoleAPICalled"].includes(message.method)) {
      // Save all warnings/errors, including missing assets and shader compilation failures.
      results.diagnostics.push({ method: message.method, params: message.params });
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    const timeout = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(next, (message) => {
      clearTimeout(timeout);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async (expression) => {
    const value = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  await call("Runtime.enable");
  await call("Log.enable");
  await call("Page.enable");
  results.browser = await call("Browser.getVersion");
  await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  console.log(`Artifacts: ${output}`);
  // Rotate order across rounds: each size gets an early, middle and late load.
  for (let round = 0; round < rounds; round++) {
    const order = cells.map((_, index) => cells[(index + round) % cells.length]);
    for (const cell of order) {
      console.log(`Loading ${map}: round ${round + 1}, cell ${cell}`);
      const diagnosticStart = results.diagnostics.length;
      await call("Page.navigate", { url: `http://127.0.0.1:${port}/__bsp_performance?${new URLSearchParams({ map, cell: String(cell) })}` });
      let state;
      for (let i = 0; i < 600; i++) {
        state = await evaluate("window.bspPerformance?.state()");
        if (state?.failure || state?.shaderErrors.length) throw new Error(JSON.stringify(state));
        if (state?.ready && state.frames > 20) break;
        await delay(250);
      }
      if (!state?.ready || !state.pvs?.enabled || state.pvs.currentCluster < 0 || state.webGLVersion !== 2) {
        throw new Error(`Fixture readiness/PVS failed: ${JSON.stringify(state)}`);
      }
      if (spawns.some((index) => !state.spawns[index])) throw new Error("Requested spawn is missing");
      const run = { round: round + 1, cell, state, diagnosticStart, samples: [] };
      results.runs.push(run);
      console.log(`GPU: ${state.gl.renderer}; warming ${spawns.length} views`);
      for (const index of spawns) await evaluate(`window.bspPerformance.warmup(${index}, ${sweepSeconds})`);
      for (const [index, sweep] of [...spawns.map((index) => [index, false]), [spawns[0], true]]) {
        const sample = await evaluate(`window.bspPerformance.capture(${index}, ${sweep ? sweepSeconds : seconds}, ${sweep})`);
        if (!sample.report.frames) throw new Error("Capture produced no frames");
        run.samples.push(sample);
        console.log(JSON.stringify({ round: round + 1, cell, index, sweep, fps: sample.observedFps,
          interval: sample.frameIntervalMs, cpu: sample.report.cpuRenderMs,
          active: sample.report.activeMeshesEvaluationMs, gpu: sample.report.gpuFrameMs,
          draw: sample.report.drawCalls, compiles: sample.report.shaderCompilation.count }));
        if (round === 0 && !sweep) {
          const shot = await call("Page.captureScreenshot", { format: "png" });
          await writeFile(join(output, `cell-${cell}-spawn-${index}.png`), Buffer.from(shot.data, "base64"));
        }
        await save();
      }
      run.finalState = await evaluate("window.bspPerformance.state()");
      run.diagnosticEnd = results.diagnostics.length;
      if (!run.finalState.ready || run.finalState.shaderErrors.length) throw new Error("Rendering became unready");
      await save();
    }
  }
  results.complete = true;
} catch (error) {
  results.failure = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  await save();
  ws?.close();
  child?.kill();
  await server.close();
  console.log(`Saved ${join(output, "results.json")}`);
}
