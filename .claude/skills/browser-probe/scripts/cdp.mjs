// Headless Edge driven over the Chrome DevTools Protocol, with Node's built-in
// WebSocket. Import it from a probe script:
//
//   import { openBrowser, bootGame, sleep } from "./cdp.mjs";
//
// Set EDGE_PATH to use another Chromium browser, QA_FLAGS for extra flags and
// QA_ALL_LOGS=1 to keep every console message, not only warnings and errors.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

export async function openBrowser({ width = 1280, height = 720 } = {}) {
  const port = 9400 + Math.floor(Math.random() * 300);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shag-probe-edge-"));
  const edge = spawn(
    EDGE,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      // Reach the real GPU for both WebGL2 and WebGPU.
      "--enable-unsafe-webgpu",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--no-first-run",
      "--mute-audio",
      "--disable-sync",
      "--autoplay-policy=no-user-gesture-required",
      ...(process.env.QA_FLAGS ? process.env.QA_FLAGS.split(" ") : []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error(`Edge did not open a debugging port (${EDGE})`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  let id = 0;
  const pending = new Map();
  /** Console warnings/errors, exceptions and browser log entries. */
  const logs = [];
  /** HTTP responses with status 400 or above. */
  const failed = [];
  /** WebSocket frames received, when captureFrames is on: the reliable oracle for lobby traffic. */
  const frames = [];
  let captureFrames = false;

  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === "Runtime.consoleAPICalled" && (process.env.QA_ALL_LOGS || /error|warn/.test(m.params.type))) {
      logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ").replace(/\s+/g, " ").slice(0, 260)}`);
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      logs.push(`EXCEPTION: ${(d.exception?.description ?? d.text).replace(/\s+/g, " ").slice(0, 400)}`);
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level !== "verbose") {
      logs.push(`browser-${m.params.entry.level}: ${m.params.entry.text.slice(0, 200)} ${m.params.entry.url ?? ""}`);
    }
    if (m.method === "Network.responseReceived" && m.params.response.status >= 400) {
      failed.push(`${m.params.response.status} ${m.params.response.url}`);
    }
    if (captureFrames && m.method === "Network.webSocketFrameReceived") {
      frames.push({ at: Date.now(), data: m.params.response.payloadData });
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i);
          resolve({});
        }
      }, 60000);
    });

  /** Evaluate an expression in the page, awaiting promises; returns its value or "EVAL-ERR: ...". */
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return `EVAL-ERR: ${(r.result.exceptionDetails.exception?.description ?? "").slice(0, 300)}`;
    return r.result?.result?.value;
  };
  const shot = async (file) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) fs.writeFileSync(file, Buffer.from(r.result.data, "base64"));
    return !!r.result?.data;
  };
  const click = (selector) =>
    ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing'; el.click(); return 'ok'; })()`);
  const key = async (k, code = k) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code });
  };
  /** Run one console command through the command registry; returns its output text. */
  const command = (cmd) =>
    ev(`(async () => { const { CommandRegistry } = await import('/src/engine/console/CommandRegistry.ts'); const r = await CommandRegistry.getInstance().executeChecked(${JSON.stringify(cmd)}); return (r.ok ? '' : 'FAILED: ') + String(r.output ?? ''); })()`);

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Log.enable");

  const removeProfile = () => {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  // Killing msedge.exe alone leaves its GPU and renderer processes running on
  // Windows (about 500 MB each set), so take down the whole tree. A probe killed
  // by `timeout` or Ctrl+C never reaches its `finally`, hence the signal handlers.
  let killed = false;
  const killTree = () => {
    if (killed) return;
    killed = true;
    try {
      if (process.platform === "win32" && edge.pid) {
        spawnSync("taskkill", ["/PID", String(edge.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        edge.kill("SIGKILL");
      }
    } catch {}
  };
  process.on("exit", killTree);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.once(signal, () => {
      killTree();
      removeProfile();
      process.exit(130);
    });
  }
  const close = async () => {
    try {
      await Promise.race([send("Browser.close"), sleep(1000)]);
    } catch {}
    ws.close();
    killTree();
    await sleep(500);
    removeProfile();
  };

  return {
    send, ev, shot, click, key, command, logs, failed, frames, close,
    setCaptureFrames: (on) => { captureFrames = on; },
  };
}

/**
 * Open the game and get past the start screen and the welcome step. Resolves
 * once `window.scene` exists. The start screen waits for a click; without it
 * the engine never boots.
 */
export async function bootGame(b, url = "http://127.0.0.1:3100/") {
  await b.send("Page.navigate", { url });
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (await b.ev("!!document.querySelector('.ui-loading-screen--ready')")) break;
  }
  if ((await b.click(".boot__start")) !== "ok") {
    await b.ev("import('/src/engine/ui/LoadingScreen.ts').then((m) => m.LoadingScreen.forceDismiss())");
  }
  await sleep(3000);
  await b.ev("document.querySelector('.welcome button[type=submit]')?.click()");
  for (let i = 0; i < 60; i++) {
    if (await b.ev("!!window.scene")) return;
    await sleep(500);
  }
  throw new Error("the game did not boot (no window.scene)");
}

/** Wait until a map's BSP geometry is in the scene and the loading overlay is gone. */
export async function waitForMap(b, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    const ready = await b.ev(
      "!!window.scene?.meshes?.some((m) => m.name.startsWith('bsp_tex')) && !document.querySelector('.ui-map-loading-overlay')",
    );
    if (ready === true) return;
  }
  throw new Error("the map did not finish loading");
}
