/** Read the selected backend's public Babylon adapter description. */
export function readEngineGraphics(engine) {
  const method = engine.isWebGPU === true ? 'getInfo' : 'getGlInfo';
  return typeof engine[method] === 'function' ? engine[method]() : null;
}
