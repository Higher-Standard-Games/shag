import * as media from '/mediabunny.mjs';
import { timestamps, outputAt } from '/timeline.mjs';

const WIDTH = 1920, HEIGHT = 1080, FPS = 60, SECONDS = 6, FRAMES = FPS * SECONDS, RATE = 48000;
const flashes = [60, 180, 300];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const save = async (name, data) => {
  const response = await fetch(`/save/${name}`, { method: 'POST', body: data });
  if (!response.ok) throw new Error(`Saving ${name}: HTTP ${response.status}`);
};
const status = message => { document.querySelector('#status').textContent = message; };

function glSource() {
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false, antialias: false });
  assert(gl, 'WebGL2 unavailable');
  const shader = (type, source) => {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    assert(gl.getShaderParameter(s, gl.COMPILE_STATUS), gl.getShaderInfoLog(s)); return s;
  };
  const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
    const vec2 p[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
    void main(){gl_Position=vec4(p[gl_VertexID],0.,1.);}`);
  const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; uniform float phase; out vec4 color;
    void main(){vec2 uv=gl_FragCoord.xy/vec2(1920.,1080.);
    color=vec4(0.06+0.12*uv.x,0.12+0.12*uv.y,0.32,1.);
    if(abs(uv.x-(0.15+phase*0.7))<0.035 && abs(uv.y-0.5)<0.07)color=vec4(0.1,0.95,0.2,1.);}`);
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  assert(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program));
  gl.useProgram(program); gl.viewport(0, 0, WIDTH, HEIGHT);
  const phase = gl.getUniformLocation(program, 'phase');
  return {
    canvas, gl,
    draw(i) { gl.uniform1f(phase, i / Math.max(1, FRAMES - 1)); gl.drawArrays(gl.TRIANGLES, 0, 3); },
    dispose() { gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

function compose(ctx, source, i) {
  ctx.drawImage(source.canvas, 0, 0);
  ctx.fillStyle = '#261f3c'; ctx.fillRect(40, 40, 240, 100);
  ctx.fillStyle = '#ffda72'; ctx.font = 'bold 48px Arial'; ctx.fillText('HP 100', 56, 108);
  ctx.fillStyle = '#ffffff'; ctx.font = '28px Arial'; ctx.fillText(`FRAME ${i} / ${FRAMES}`, 40, 190);
  // Ten robust binary cells let us identify every decoded picture, not just count callbacks.
  for (let bit = 0; bit < 10; bit++) {
    ctx.fillStyle = i & (1 << bit) ? '#ffffff' : '#000000'; ctx.fillRect(32 + bit * 24, HEIGHT - 48, 20, 20);
  }
  ctx.fillStyle = flashes.includes(i) ? '#ff0000' : '#000000'; ctx.fillRect(900, 40, 100, 100);
  // A cinematic title and veil are independently composited, not captured from DOM.
  if (i < 24) { ctx.fillStyle = `rgba(0,0,0,${1 - i / 24})`; ctx.fillRect(0, 0, WIDTH, HEIGHT); }
  if (i >= 24 && i < 50) { ctx.fillStyle = '#ffffff'; ctx.font = 'bold 70px Arial'; ctx.fillText('HIGHLIGHT EXPORT', 560, 300); }
  // Keep the frame ID outside the veil so validation includes the title hold.
  for (let bit = 0; bit < 10; bit++) { ctx.fillStyle = i & (1 << bit) ? '#ffffff' : '#000000'; ctx.fillRect(32 + bit * 24, HEIGHT - 48, 20, 20); }
}

async function makeAudio() {
  const context = new OfflineAudioContext(2, RATE * SECONDS, RATE);
  for (const [i, time] of [1, 3, 5].entries()) {
    const buffer = context.createBuffer(1, RATE * 0.025, RATE);
    const data = buffer.getChannelData(0);
    for (let j = 0; j < data.length; j++) data[j] = Math.sin(j * 2 * Math.PI * 1200 / RATE) * Math.sin(Math.PI * j / data.length) * 0.8;
    const source = context.createBufferSource(); source.buffer = buffer;
    const panner = context.createPanner(); panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse';
    panner.positionX.value = [-2, 2, 0][i]; panner.positionZ.value = -1;
    source.connect(panner).connect(context.destination); source.start(time);
  }
  const started = performance.now(); const buffer = await context.startRendering();
  return { buffer, renderMs: performance.now() - started };
}

function analyzePcm(buffer, origin = 0) {
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  return [1, 3, 5].map(expected => {
    let first = null; const energy = [0, 0];
    for (let j = Math.round((expected - 0.04 - origin) * RATE); j < Math.round((expected + 0.06 - origin) * RATE); j++) {
      if (j < 0 || j >= buffer.length) continue;
      const magnitude = Math.max(...channels.map(c => Math.abs(c[j])));
      if (first === null && magnitude > 0.025) first = origin + j / RATE;
      for (let c = 0; c < 2; c++) energy[c] += channels[c][j] ** 2;
    }
    return { expected, first, onsetErrorMs: first === null ? null : (first - expected) * 1000, leftEnergy: energy[0], rightEnergy: energy[1] };
  });
}

async function inspectMp4(buffer, name) {
  const input = new media.Input({ source: new media.BufferSource(buffer), formats: media.ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
  assert(video && audio, 'Both video and audio tracks must exist');
  const packets = new media.EncodedPacketSink(video);
  const decoderConfig = await video.getDecoderConfig();
  const scratch = document.createElement('canvas'); scratch.width = WIDTH; scratch.height = HEIGHT;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  const frames = []; let decodeError;
  const decoder = new VideoDecoder({
    output(frame) {
      try {
        ctx.drawImage(frame, 0, 0); let id = 0;
        for (let bit = 0; bit < 10; bit++) if (ctx.getImageData(42 + bit * 24, HEIGHT - 38, 1, 1).data[0] > 127) id |= 1 << bit;
        const flash = ctx.getImageData(950, 90, 1, 1).data;
        const moving = ctx.getImageData(Math.round((0.15 + id / (FRAMES - 1) * 0.7) * WIDTH), HEIGHT / 2, 1, 1).data;
        frames.push({ id, timestamp: frame.timestamp, width: frame.displayWidth, height: frame.displayHeight, worldCorrect: moving[1] > 150 && moving[0] < 100, flash: flash[0] > 180 && flash[1] < 70 });
      } catch (e) { decodeError = e; } finally { frame.close(); }
    }, error(e) { decodeError = e; },
  });
  decoder.configure(decoderConfig);
  for await (const packet of packets.packets()) {
    decoder.decode(packet.toEncodedVideoChunk());
    while (decoder.decodeQueueSize >= 8 && !decodeError) await sleep(0);
  }
  await decoder.flush(); decoder.close(); if (decodeError) throw decodeError;
  frames.sort((a, b) => a.timestamp - b.timestamp);
  assert(frames.length === FRAMES, `Expected ${FRAMES} decoded frames; got ${frames.length}`);
  const times = timestamps(FRAMES, FPS);
  assert(frames.every((frame, i) => frame.id === i), 'Missing, duplicate or out-of-order decoded frame ID');
  assert(frames.every((frame, i) => Math.abs(frame.timestamp - times[i]) <= 2), 'Video timestamps do not match the output clock');
  assert(frames.every(frame => frame.width === WIDTH && frame.height === HEIGHT), 'Wrong encoded dimensions');
  assert(frames.every(frame => frame.id < 24 || frame.worldCorrect), 'Animated WebGL picture missing from composition after intro veil');
  const flashTimes = frames.filter(frame => frame.flash).map(frame => frame.timestamp / 1e6);
  assert(JSON.stringify(flashTimes) === JSON.stringify([1, 3, 5]), 'Flash frames did not survive mux/decode');
  const ac = new AudioContext({ sampleRate: RATE });
  const decodedAudio = await ac.decodeAudioData(buffer.slice(0));
  const audioAnalysis = analyzePcm(decodedAudio);
  await ac.close();
  assert(audioAnalysis.every(p => p.first !== null && Math.abs(p.onsetErrorMs) <= 1000 / FPS), 'AAC audio is not aligned to flashes');
  assert(audioAnalysis[0].leftEnergy > audioAnalysis[0].rightEnergy * 4, 'Left spatial cue not preserved');
  assert(audioAnalysis[1].rightEnergy > audioAnalysis[1].leftEnergy * 4, 'Right spatial cue not preserved');
  const element = document.createElement('video'); const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
  element.src = blobUrl;
  await new Promise((resolve, reject) => { element.onloadedmetadata = resolve; element.onerror = () => reject(new Error('Native HTML video rejected MP4')); });
  const native = { width: element.videoWidth, height: element.videoHeight, duration: element.duration };
  native.seekFlashes = [];
  for (const time of [1.001, 3.001, 5.001]) {
    await new Promise((resolve, reject) => { element.onseeked = resolve; element.onerror = () => reject(new Error('Native video seek failed')); element.currentTime = time; });
    ctx.drawImage(element, 0, 0);
    const pixel = ctx.getImageData(950, 90, 1, 1).data;
    assert(pixel[0] > 180 && pixel[1] < 70, `Native player flash absent at ${time}`);
    native.seekFlashes.push(time);
  }
  element.removeAttribute('src'); element.load(); URL.revokeObjectURL(blobUrl);
  assert(native.width === WIDTH && native.height === HEIGHT && Math.abs(native.duration - SECONDS) < 0.06, 'Native MP4 metadata invalid');
  await save(`${name}-decoded.png`, await new Promise(resolve => scratch.toBlob(resolve)));
  const result = { decodedFrames: frames.length, firstId: frames[0].id, lastId: frames.at(-1).id, timestampsCorrect: true, flashTimes, audioAnalysis, native, videoCodec: decoderConfig.codec, audioCodec: await audio.getCodecParameterString(), bytes: buffer.byteLength, pcmFrames: decodedAudio.length };
  input.dispose(); return result;
}

async function runCase(name, stalled = false, cancelAt = null, streamed = false) {
  status(`${name}: encoding`);
  const canvas = document.querySelector('#output'), ctx = canvas.getContext('2d');
  const source = glSource();
  const audio = await makeAudio();
  // Fixed backing store emulates positional disk writes only for this short test.
  // Production should write to FileSystemWritableFileStream, not retain these bytes.
  const storage = streamed ? new Uint8Array(8 * 1024 * 1024) : null;
  const streamStats = { writes: 0, extent: 0, maxChunkBytes: 0, inFlight: 0, maxInFlight: 0 };
  const target = streamed ? new media.StreamTarget(new WritableStream({ async write(chunk) {
    streamStats.inFlight++; streamStats.maxInFlight = Math.max(streamStats.maxInFlight, streamStats.inFlight);
    try {
      await sleep(10);
      assert(chunk.position + chunk.data.length <= storage.length, 'PoC positional store exceeded');
      storage.set(chunk.data, chunk.position);
      streamStats.extent = Math.max(streamStats.extent, chunk.position + chunk.data.length);
      streamStats.writes++; streamStats.maxChunkBytes = Math.max(streamStats.maxChunkBytes, chunk.data.length);
    } finally { streamStats.inFlight--; }
  } }), { chunked: true, chunkSize: 65536 }) : new media.BufferTarget();
  const output = new media.Output({ format: new media.Mp4OutputFormat(streamed ? { fastStart: false } : {}), target });
  const videoSource = new media.CanvasSource(canvas, { codec: 'avc', quality: new media.Quality({ bitrate: 20e6 }), keyFrameInterval: 1 });
  const audioSource = new media.AudioBufferSource({ codec: 'aac', quality: new media.Quality({ bitrate: 192e3 }) });
  output.addVideoTrack(videoSource, { frameRate: FPS }); output.addAudioTrack(audioSource);
  let submitted = 0, cancelled = false;
  const started = performance.now(), times = timestamps(FRAMES, FPS);
  try {
    await output.start();
    // Interleave independent tracks: adding the whole audio first can otherwise wait for video.
    let audioError;
    const audioPromise = audioSource.add(audio.buffer).then(() => audioSource.close(), error => { audioError = error; });
    for (let i = 0; i < FRAMES; i++) {
      if (cancelAt !== null && i === cancelAt) { cancelled = true; break; }
      source.draw(i); compose(ctx, source, i);
      await videoSource.add(times[i] / 1e6, (times[i + 1] - times[i]) / 1e6);
      submitted++;
      if (stalled) {
        await sleep(15);
        if (i % 30 === 15) await sleep(250);
      }
    }
    if (cancelled) { await output.cancel(); await audioPromise; return { cancelled, submitted, finalized: output.target.buffer !== null }; }
    videoSource.close(); await audioPromise; if (audioError) throw audioError;
    const writesBeforeFinalize = streamStats.writes;
    await output.finalize();
    const wallMs = performance.now() - started;
    const buffer = streamed ? storage.slice(0, streamStats.extent).buffer : output.target.buffer;
    if (streamed) assert(writesBeforeFinalize > 0 && streamStats.maxInFlight === 1, 'Incremental stream/backpressure not demonstrated');
    await save(`${name}.mp4`, buffer);
    await save(`${name}-composed.png`, await new Promise(resolve => canvas.toBlob(resolve)));
    const inspection = await inspectMp4(buffer, name);
    return { ...inspection, submitted, wallMs, offlineAudioRenderMs: audio.renderMs, sourceAttributes: source.gl.getContextAttributes(), previewCss: { width: canvas.clientWidth, height: canvas.clientHeight }, cancelled, ...(streamed ? { stream: { ...streamStats, writesBeforeFinalize } } : {}) };
  } finally {
    try { if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel(); }
    finally { source.dispose(); }
  }
}

async function variableSpeedAudio(segments) {
  const context = new OfflineAudioContext(2, RATE * SECONDS, RATE);
  const buffer = context.createBuffer(1, RATE * 5, RATE), data = buffer.getChannelData(0);
  const cueTimes = [1, 2.5, 4];
  for (const time of cueTimes) for (let j = 0; j < 480; j++) data[Math.round(time * RATE) + j] = Math.sin(j * 2 * Math.PI * 1200 / RATE) * Math.sin(Math.PI * j / 480) * 0.8;
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
  source.playbackRate.setValueAtTime(1, 0); source.playbackRate.setValueAtTime(0.5, 2);
  source.playbackRate.setValueAtTime(0.5, 4); source.playbackRate.linearRampToValueAtTime(1.5, 6); source.start(0);
  const rendered = await context.startRendering(), pcm = rendered.getChannelData(0);
  return cueTimes.map(sourceTime => {
    const expected = outputAt(sourceTime, segments); let onset = null;
    for (let i = Math.floor((expected - 0.01) * RATE); i < Math.ceil((expected + 0.02) * RATE); i++) if (Math.abs(pcm[i]) > 0.025) { onset = i / RATE; break; }
    assert(onset !== null && Math.abs(onset - expected) < 0.002, 'Native audio automation disagrees with timeline mapping');
    return { sourceTime, expected, onset, errorMs: (onset - expected) * 1000 };
  });
}

async function extras() {
  const source = glSource(); source.draw(120);
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(source.canvas, 0, 0);
  const worldPixel = [...ctx.getImageData(960, 540, 1, 1).data];
  const debug = source.gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debug ? source.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : source.gl.getParameter(source.gl.RENDERER);
  source.dispose();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><foreignObject width="320" height="180"><div xmlns="http://www.w3.org/1999/xhtml" style="background:#261f3c;color:#ffda72;font:bold 38px Arial;padding:20px;transform:rotate(-2deg)">HUD 100</div></foreignObject></svg>`;
  let foreignObject;
  try {
    const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const cctx = c.getContext('2d'); cctx.drawImage(image, 0, 0); cctx.getImageData(30, 30, 1, 1);
    await save('foreign-object.png', await new Promise(resolve => c.toBlob(resolve)));
    foreignObject = { readable: true, note: 'Basic inline style only; no actual game CSS/fonts acceptance.' };
  } catch (error) { foreignObject = { readable: false, error: String(error) }; }
  let webgpu;
  try {
    const adapter = await navigator.gpu?.requestAdapter(); assert(adapter, 'No adapter');
    const device = await adapter.requestDevice(), c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const context = c.getContext('webgpu'); context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
    const encoder = device.createCommandEncoder(); const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: {r:0.2,g:0.8,b:0.3,a:1}, loadOp:'clear', storeOp:'store' }] });
    pass.end(); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    const copy = document.createElement('canvas'); copy.width=320;copy.height=180;const cctx=copy.getContext('2d');cctx.drawImage(c,0,0);
    const pixel=[...cctx.getImageData(10,10,1,1).data];
    assert(Math.abs(pixel[0]-51)<4 && Math.abs(pixel[1]-204)<4, 'Wrong WebGPU composition colour');
    webgpu={ copied:true,pixel };context.unconfigure();device.destroy();
  } catch(error) { webgpu={copied:false,error:String(error)}; }
  const segments=[{start:0,end:2,from:1,to:1},{start:2,end:4,from:0.5,to:0.5},{start:4,end:6,from:0.5,to:1.5}];
  return { worldPixel, renderer, foreignObject, webgpu, variableSpeedAudio: await variableSpeedAudio(segments) };
}

window.poc = { runCase, extras, async capabilities() {
  const avc={codec:'avc1.64002a',width:WIDTH,height:HEIGHT,framerate:FPS,bitrate:20e6};
  const aac={codec:'mp4a.40.2',sampleRate:RATE,numberOfChannels:2,bitrate:192e3};
  return { userAgent:navigator.userAgent, secureContext:isSecureContext, video:(await VideoEncoder.isConfigSupported(avc)),audio:(await AudioEncoder.isConfigSupported(aac)),mediaVersion:'1.62.1',webgpu:!!navigator.gpu };
} };
window.pocReady = true;
