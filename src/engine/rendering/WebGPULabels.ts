/**
 * Stable labels for the WebGPU objects Babylon makes every frame.
 *
 * Babylon labels each command encoder and render pass with the frame number
 * (`[frameId|counter] - MainRenderPass`) and builds attachment-view labels by
 * concatenation, so every frame hands the browser several new strings. The
 * browser keeps each string it receives as an external string, and V8 walks
 * all of them in the pause of every major collection: on a long match that
 * walk alone grew past 70 ms. Here each such label becomes one string per
 * kind (the frame stamp dropped), the same object every frame, so the browser
 * receives it once.
 */

/** Labels kept as one string each; past this many, new ones pass through unchanged. */
const MAX_STABLE_LABELS = 4096;

const stableLabels = new Map<string, string>();

/** `label` without Babylon's frame stamp, as the one string kept for that text. */
export function stableWebGPULabel(label: string): string {
  const stamp = label.indexOf("] - ");
  const text = label.startsWith("[") && stamp >= 0 ? label.slice(stamp + 4) : label;
  const kept = stableLabels.get(text);
  if (kept !== undefined) return kept;
  if (stableLabels.size < MAX_STABLE_LABELS) stableLabels.set(text, text);
  return text;
}

type Labelled = { label?: string } | undefined;
type Method = (descriptor?: Labelled, ...rest: unknown[]) => unknown;

const INSTALLED = Symbol.for("shag.stableWebGPULabels");

function stabilize(proto: object | undefined, name: string): void {
  const target = proto as Record<string, unknown> | undefined;
  const original = target?.[name] as Method | undefined;
  if (!target || typeof original !== "function") return;
  target[name] = function (this: unknown, descriptor?: Labelled, ...rest: unknown[]) {
    if (typeof descriptor?.label === "string") descriptor.label = stableWebGPULabel(descriptor.label);
    return original.call(this, descriptor, ...rest);
  };
}

/**
 * Route the per-frame WebGPU calls (command encoders, render and compute
 * passes, texture views) through `stableWebGPULabel`. Once per page; a
 * browser without WebGPU is left alone.
 */
export function installStableWebGPULabels(globals: Record<string, unknown> = globalThis as never): void {
  const device = globals.GPUDevice as { prototype: Record<symbol, unknown> } | undefined;
  if (!device || device.prototype[INSTALLED]) return;
  device.prototype[INSTALLED] = true;
  const encoder = (globals.GPUCommandEncoder as { prototype: object } | undefined)?.prototype;
  const texture = (globals.GPUTexture as { prototype: object } | undefined)?.prototype;
  stabilize(device.prototype, "createCommandEncoder");
  stabilize(encoder, "beginRenderPass");
  stabilize(encoder, "beginComputePass");
  stabilize(texture, "createView");
}
