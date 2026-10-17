// Opt-in diagnostic preload for Node (--import) and Bun (--preload).
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const destination = process.env.SHAG_SERVER_PROFILE;
if (destination) {
  mkdirSync(path.dirname(destination), { recursive: true });
  const started = performance.now();
  let previous = started;
  let diagnosticScheduled = false;
  const sample = (stage, details = {}) => {
    const now = performance.now();
    appendFileSync(destination, `${JSON.stringify({
      stage, pid: process.pid, runtime: process.versions.bun ? "bun" : "node",
      version: process.versions.bun ?? process.versions.node,
      elapsedMs: now - started, timestamp: Date.now(), uptimeSeconds: process.uptime(),
      memory: process.memoryUsage(), cpu: process.cpuUsage(), ...details,
    })}\n`);
    if (stage === "listening" && !diagnosticScheduled && process.env.SHAG_SERVER_PROFILE_GC === "1") {
      diagnosticScheduled = true;
      setTimeout(async () => {
        sample("before-diagnostic-gc");
        if (typeof globalThis.gc === "function") globalThis.gc();
        else if (typeof globalThis.Bun?.gc === "function") globalThis.Bun.gc(true);
        else throw new Error("Diagnostic GC unavailable");
        sample("after-diagnostic-gc");
        if (process.env.SHAG_SERVER_PROFILE_HEAP) {
          const { writeHeapSnapshot } = await import("node:v8");
          writeHeapSnapshot(process.env.SHAG_SERVER_PROFILE_HEAP);
        }
      }, 2000).unref();
    }
  };
  globalThis.__shagServerMemory = sample;
  sample("bootstrap");
  const timer = setInterval(() => {
    const now = performance.now();
    sample("sample", { sampleDelayMs: Math.max(0, now - previous - 500) });
    previous = now;
  }, 500);
  timer.unref();
  process.once("exit", () => { clearInterval(timer); sample("exit"); });
}
