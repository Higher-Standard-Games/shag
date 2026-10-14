// Template probe: boot the game, play a demo and measure something in the
// running scene. Copy it to a scratch directory and change the measurement.
//
//   node .claude/skills/browser-probe/scripts/demo-probe.mjs <demo.shagdemo> [seconds]
//
// Expects the private probe server on :3100 (private-vite.mjs). Demos live in
// public/data/demos; pass the file name with its .shagdemo extension.
import { bootGame, openBrowser, sleep, waitForMap } from "./cdp.mjs";

const demo = process.argv[2];
const seconds = Number(process.argv[3] ?? 10);
if (!demo) {
  console.error("usage: demo-probe.mjs <demo.shagdemo> [seconds]");
  process.exit(2);
}

const b = await openBrowser({ width: 1280, height: 720 });
try {
  await bootGame(b);
  console.log("demo:", await b.command(`demo ${demo}`));
  // demoplay's promise can stay pending while playback runs: do not await it.
  void b.command("demoplay");
  await waitForMap(b);
  await sleep(1500);

  const report = await b.ev(`(async () => {
    const scene = window.scene;
    const engine = scene.getEngine();
    // The scene renders through scene.activeCameras when several are set; read the first.
    const camera = scene.activeCameras?.[0] ?? scene.activeCamera;
    const st = { frames: 0, fpsMin: Infinity, fpsMax: 0, camera: camera?.name };
    const obs = scene.onAfterRenderObservable.add(() => {
      st.frames++;
      const fps = engine.getFps();
      st.fpsMin = Math.min(st.fpsMin, fps);
      st.fpsMax = Math.max(st.fpsMax, fps);
    });
    await new Promise((r) => setTimeout(r, ${seconds * 1000}));
    scene.onAfterRenderObservable.remove(obs);
    st.fpsMin = Math.round(st.fpsMin);
    st.fpsMax = Math.round(st.fpsMax);
    return JSON.stringify(st);
  })()`);
  console.log(report);
  await b.shot("demo-probe.png");
} finally {
  // Offline, the lobby connection fails by design; leave that out.
  const errors = b.logs.filter((l) => /EXCEPTION|error/i.test(l) && !/LobbyClient|lobby server/.test(l));
  console.log(errors.length ? `errors:\n  ${errors.slice(0, 5).join("\n  ")}` : "errors: none");
  if (b.failed.length) console.log(`failed requests:\n  ${b.failed.slice(0, 5).join("\n  ")}`);
  await b.close();
}
