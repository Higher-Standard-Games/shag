import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openBrowser, sleep } from "../../.claude/skills/browser-probe/scripts/cdp.mjs";

// Start the private no-HMR Vite server first; no lobby or release media changes.
const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const backend = process.argv[2] ?? "webgl2";
const mode = process.argv[3] ?? "effects";
const port = Number(process.argv[4] ?? 3117);
const reference = process.argv[5];
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be an integer from 1 to 65535");
if (!["webgl2", "webgpu"].includes(backend) || !["effects", "materials", "fixed-scale"].includes(mode)) {
  throw new Error("usage: node scripts/benchmarks/renderer-groundwork.mjs [webgl2|webgpu] [effects|materials|fixed-scale] [port] [reference-commit]");
}
if (reference) {
  if (!/^[a-f0-9]{7,40}$/.test(reference) || mode === "materials") throw new Error("Reference requires effects/fixed-scale mode and a commit hash");
  const sourcePath = mode === "effects" ? "weapon/voltaic/VoltaicEffectRenderer.ts" : "loader/shader/ShaderAnimationSystem.ts";
  const source = execFileSync("git", ["-C", root, "show", `${reference}:src/engine/${sourcePath}`], { encoding: "utf8" });
  fs.mkdirSync(".cache/renderer-groundwork", { recursive: true });
  const localPrefix = mode === "effects" ? "/src/engine/weapon/voltaic/" : "/src/engine/loader/shader/";
  // The no-HMR server caches modules: each immutable revision needs its own URL.
  fs.writeFileSync(`.cache/renderer-groundwork/${mode === "effects" ? "VoltaicReference" : "ShaderAnimationReference"}-${reference}.ts`, source.replaceAll('"./', `"${localPrefix}`).replaceAll('"../../', '"/src/engine/'));
}
const browser = await openBrowser({ width: 640, height: 480 });
try {
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}/engine.json` });
  await sleep(500);
  const result = await browser.ev(`import('/src/engine/rendering/__qa__/RendererGroundworkFixture.ts').then(m => m.runGroundworkFixture(${JSON.stringify(backend)}, ${JSON.stringify(mode)}, ${JSON.stringify(reference ?? false)}))`);
  const record = { reference: reference ?? null, result, logs: browser.logs, failed: browser.failed };
  fs.mkdirSync(".cache/renderer-groundwork", { recursive: true });
  fs.writeFileSync(`.cache/renderer-groundwork/${mode}-${backend}${reference ? "-reference" : ""}.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  if (!result || typeof result !== "object" || result.passed === false || browser.failed.length || browser.logs.some((line) => /error|EXCEPTION/.test(line))) process.exitCode = 1;
} finally { await browser.close(); }
// The shared CDP helper leaves request timeout timers alive after closing Edge.
process.exit(process.exitCode ?? 0);
