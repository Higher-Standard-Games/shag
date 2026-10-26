/**
 * Babylon's WebGPU pipeline cache keys every pipeline on the stencil read and
 * write masks, even while stencil is disabled. Its stencil composer stops
 * updating them when stencil turns off, so whatever the last stencil user set
 * stays in every later key. An outlined player behind a transparent material
 * sets the write mask to 4 for one draw (OutlineRenderer), and from then on
 * every material needs a second pipeline that differs only in a mask nothing
 * reads: a burst of pipeline compiles, and frames of a second or more, the
 * first time an outline is drawn.
 *
 * With stencil disabled the ops are all KEEP, so the masks have no effect.
 * Resetting them to their defaults keeps one key per disabled-stencil state.
 */

import { WebGPUStencilStateComposer } from "@babylonjs/core/Engines/WebGPU/webgpuStencilStateComposer";

const DEFAULT_MASK = 0xff;

let installed = false;

/** Patch the composer once per page; idempotent. Returns false if Babylon's shape changed. */
export function stabilizeDisabledStencilKeys(): boolean {
  if (installed) return true;
  const proto = WebGPUStencilStateComposer.prototype as unknown as {
    apply(): void;
    enabled: boolean;
    mask: number;
    funcMask: number;
  };
  const apply = proto.apply;
  const descriptor = (name: string) => Object.getOwnPropertyDescriptor(proto, name);
  if (typeof apply !== "function" || !descriptor("mask")?.set || !descriptor("funcMask")?.set) return false;
  proto.apply = function (this: typeof proto) {
    apply.call(this);
    if (this.enabled) return;
    this.mask = DEFAULT_MASK;
    this.funcMask = DEFAULT_MASK;
  };
  installed = true;
  return true;
}
