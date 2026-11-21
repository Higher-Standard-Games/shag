// Render a demo to MP4 through the real export page in headless Edge, then copy
// the finished file to disk.
//
//   node export-video.mjs --demo <file>.shagdemo --kind match|reel [--minutes 1|2|3]
//        [--follow <player name>] [--song <part of file name>] [--start <s|m:ss|last:N>]
//        --out <file.mp4> [--port 3100]
//
// --start last:60 starts the song 60 seconds before its end. The demo is read
// from public/data/demos. The private Vite server must already run on --port
// (browser-probe skill, private-vite.mjs). See SKILL.md beside this folder.
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { openBrowser, sleep } from "../../browser-probe/scripts/cdp.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url)).replaceAll("\\", "/");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const kind = args.kind ?? "reel";
const port = args.port ?? "3100";
if (!args.demo || !args.out) throw new Error("--demo and --out are required");
// A full match renders at about 3.5x its length; leave room for that and the audio mix
const limitMs = Number(args.limit ?? (kind === "match" ? 4 * 3600_000 : 3600_000));
setTimeout(() => {
  console.log("time limit reached");
  process.exit(3);
}, limitMs).unref();

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const b = await openBrowser({ width: 1280, height: 900 });
const q = (s) => JSON.stringify(s);
try {
  await b.send("Page.navigate", { url: `http://127.0.0.1:${port}/?videoexport=1` });
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (await b.ev("!!document.querySelector('.video-export-page')")) break;
  }
  const doc = await b.send("DOM.getDocument", {});
  const node = await b.send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "input[type=file]" });
  await b.send("DOM.setFileInputFiles", {
    nodeId: node.result.nodeId,
    files: [`${root}public/data/demos/${args.demo}`],
  });
  // The roster and the song list load in the background
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const ready = await b.ev(
      "document.querySelectorAll('#video-export-music option').length > 1 && document.querySelectorAll('#video-export-follow option').length > 0",
    );
    if (ready) break;
  }
  await b.ev("document.querySelector('.video-export-advanced').open = true");
  const set = (selector, pick) =>
    b.ev(`(() => {
      const el = document.querySelector(${q(selector)});
      const option = [...el.options].find((o) => ${pick});
      if (!option) return 'missing: ' + [...el.options].map((o) => o.textContent).join(' | ');
      el.value = option.value;
      el.dispatchEvent(new Event('change'));
      return option.textContent;
    })()`);
  if (kind === "match") {
    log("kind:", await set("#video-export-kind", "o.value === 'match'"));
    await sleep(800);
    if (args.follow) log("follow:", await set("#video-export-follow", `o.textContent.trim().toLowerCase().startsWith(${q(args.follow.toLowerCase())})`));
  } else {
    const minutes = args.minutes ?? "1";
    log("length:", await b.ev(`(() => { const r = document.querySelector('input[name=length][value="${minutes}"]'); r.checked = true; r.dispatchEvent(new Event('change')); return r.value; })()`));
  }
  if (args.song) {
    const song = await set("#video-export-music", `(o.value + ' ' + o.textContent).toLowerCase().includes(${q(args.song.toLowerCase())})`);
    log("song:", song);
    if (song.startsWith("missing")) throw new Error(song);
    let start = args.start ?? "0";
    if (start.startsWith("last:")) {
      const tail = Number(start.slice(5));
      const seconds = await b.ev(`(async () => {
        const { AudioManager } = await import('/src/engine/AudioManager.ts');
        const bytes = await AudioManager.getInstance().readSfxBytes(document.querySelector('#video-export-music').value);
        const buffer = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.slice(0));
        return buffer.duration;
      })()`);
      if (typeof seconds !== "number") throw new Error("could not read the song's length");
      const at = Math.max(0, seconds - tail);
      start = `${Math.floor(at / 60)}:${(at % 60).toFixed(3).padStart(6, "0")}`;
      log(`song length ${seconds.toFixed(3)} s; starting at ${start}`);
    }
    await b.ev(`(() => { const s = document.querySelector('#video-export-song-start'); s.value = ${q(start)}; s.dispatchEvent(new Event('input')); return s.value; })()`);
  }
  log("ui:", await b.ev("JSON.stringify({ status: document.querySelector('.status').textContent, generate: document.querySelector('.generate').disabled, music: document.querySelector('#video-export-music-help')?.textContent })"));
  await b.ev("document.querySelector('.generate').click(); true");

  let last = "";
  let silent = 0;
  const t0 = Date.now();
  for (;;) {
    await sleep(10_000);
    // The export page never idles, so the browser never collects the garbage each
    // HUD frame leaves (about 2 MB a frame): without this the tab grows past
    // 20 GB and dies some 22,000 frames into a full match.
    await b.send("HeapProfiler.collectGarbage", {});
    const reply = await b.ev(
      "JSON.stringify({ status: document.querySelector('.status').textContent, heap: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576) })",
    );
    if (typeof reply !== "string") {
      // A CDP call gives up after 60 seconds; a page that misses three in a row has crashed
      if (++silent >= 3) throw new Error(`the export page stopped answering (last status: ${last})`);
      continue;
    }
    silent = 0;
    const { status, heap } = JSON.parse(reply);
    const lead = status.replace(/\d+/g, "#");
    if (lead !== last || (Date.now() - t0) % 120_000 < 10_000)
      log(`${Math.round((Date.now() - t0) / 1000)}s`, status, `(heap ${heap} MB)`);
    last = lead;
    if (/^(Video ready|Export failed|Export cancelled)/.test(status)) break;
  }
  const size = await b.ev("(async () => { const p = await import('/src/games/fps/client/video/ExportPage.ts'); window.__file = await p.exportSession.file(); return window.__file.size; })()");
  if (!size) throw new Error(`no finished video: ${last}`);
  log(`copying ${(size / 1048576).toFixed(1)} MiB to ${args.out}`);
  const out = createWriteStream(args.out);
  const chunk = 4 * 1048576;
  for (let at = 0; at < size; at += chunk) {
    const data = await b.ev(`(async () => {
      const bytes = new Uint8Array(await window.__file.slice(${at}, ${at + chunk}).arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(s);
    })()`);
    if (typeof data !== "string") throw new Error(`chunk at ${at} did not arrive`);
    out.write(Buffer.from(data, "base64"));
  }
  await new Promise((resolve) => out.end(resolve));
  // What went into the file: duration and tracks
  log("mp4:", await b.ev(`(async () => {
    const m = await import('/node_modules/.vite-probe/deps/mediabunny.js');
    const input = new m.Input({ source: new m.BlobSource(window.__file), formats: m.ALL_FORMATS });
    const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
    return JSON.stringify({ bytes: window.__file.size, duration: await input.computeDuration(), video: v && [v.displayWidth, v.displayHeight, v.codec], audio: a && [a.codec, a.sampleRate, a.numberOfChannels] });
  })()`));
  log("done in", Math.round((Date.now() - t0) / 60000), "min");
} finally {
  const errors = b.logs.filter((l) => /EXCEPTION|error/i.test(l) && !/LobbyClient|lobby server/.test(l));
  console.log(errors.length ? `errors:\n  ${errors.slice(0, 12).join("\n  ")}` : "errors: none");
  await b.close();
}
