/**
 * Camera-space depth of the opaque scene, taken from the main pass itself.
 *
 * Soft halos and water both read the camera-space Z of the opaque scene behind
 * them. Rendered as depth passes of their own, that drew the map two and a half
 * times a frame. The main pass has already drawn every opaque surface into its
 * depth buffer by the time the transparent ones start, so this copies that
 * buffer there (one WebGL2 blit) and converts it to camera-space Z in the
 * format a `DepthRenderer` with `storeCameraSpaceZ` writes (one full-screen
 * draw), 0 where nothing was drawn.
 *
 * It works while the world camera renders into its post-process pipeline's
 * single-sampled target with a float or 24-bit depth buffer, on WebGL2.
 * Elsewhere `supports` is false and the consumers keep their own depth passes.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { RenderTargetWrapper } from "@babylonjs/core/Engines/renderTargetWrapper";
import { Effect } from "@babylonjs/core/Materials/effect";
import { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer";
import type { InternalTexture } from "@babylonjs/core/Materials/Textures/internalTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { RenderingGroup } from "@babylonjs/core/Rendering/renderingGroup";
import type { Scene } from "@babylonjs/core/scene";

const VERTEX = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform highp sampler2D depthSampler;
uniform vec2 nearFar;
void main() {
  float d = texelFetch(depthSampler, ivec2(gl_FragCoord.xy), 0).r;
  // Nothing drawn here: the value a camera-space depth pass clears to
  if (d >= 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float n = nearFar.x;
  float f = nearFar.y;
  float ndc = d * 2.0 - 1.0;
  // A far plane of 0 is Babylon's infinite projection
  float z = f > 0.0 ? 2.0 * n * f / (f + n - ndc * (f - n)) : 2.0 * n / (1.0 - ndc);
  gl_FragColor = vec4(z, 0.0, 0.0, 1.0);
}
`;

/** Depth formats a blit can copy into a depth texture of the same format. */
const BLIT_FORMATS: Record<number, number> = {
  36012: Constants.TEXTUREFORMAT_DEPTH32_FLOAT, // DEPTH_COMPONENT32F
  33190: Constants.TEXTUREFORMAT_DEPTH24, // DEPTH_COMPONENT24
};

/** Frames a request keeps the capture running without being renewed. */
const REQUEST_FRAMES = 2;

const captures = new WeakMap<Scene, SceneDepthCapture>();
/** Each main target's depth format as `formatOf` reads it; a query per frame would be a synchronous GL call. */
const targetFormats = new WeakMap<RenderTargetWrapper, number>();

type WebGLEngine = AbstractEngine & {
  _gl?: WebGL2RenderingContext;
  _currentRenderTarget?: RenderTargetWrapper | null;
  webGLVersion?: number;
};

export class SceneDepthCapture {
  private camera: Camera | null = null;
  private requestedFrame = -Infinity;
  private capturedFrame = -1;
  /** The main target the copies were sized for, and its depth format. */
  private source: RenderTargetWrapper | null = null;
  private depthTarget: RenderTargetWrapper | null = null;
  private viewZ: RenderTargetTexture | null = null;
  private effectRenderer: EffectRenderer | null = null;
  private effect: EffectWrapper | null = null;
  private hookedGroup: RenderingGroup | null = null;
  private previousHook: (() => void) | null | undefined = null;
  private readonly hook = () => {
    this.previousHook?.();
    this.capture();
  };

  static for(scene: Scene): SceneDepthCapture {
    let capture = captures.get(scene);
    if (!capture) {
      capture = new SceneDepthCapture(scene);
      captures.set(scene, capture);
    }
    return capture;
  }

  private constructor(private readonly scene: Scene) {
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  private get engine(): WebGLEngine {
    return this.scene.getEngine() as WebGLEngine;
  }

  /** The target `camera`'s main pass draws into, when it is one this can copy from. */
  private mainTarget(camera: Camera): RenderTargetWrapper | null {
    const engine = this.engine;
    if (engine.webGLVersion !== 2 || !engine._gl || engine.isWebGPU) return null;
    // The scene draws into the first post-process's input, as Babylon's post-process manager binds it
    const first = camera._postProcesses?.find((postProcess) => !!postProcess);
    const target = first?.inputTexture ?? null;
    if (!target || target.samples > 1) return null;
    return target;
  }

  /** Whether `camera`'s depth can come from its main pass this frame. */
  supports(camera: Camera): boolean {
    const target = this.mainTarget(camera);
    return !!target && this.formatOf(target) !== 0;
  }

  /** Keep capturing for `camera`; a consumer calls this each frame it reads the depth. */
  request(camera: Camera): void {
    if (this.camera !== camera) {
      this.camera = camera;
      this.capturedFrame = -1;
    }
    this.requestedFrame = this.engine.frameId;
    this.installHook();
  }

  /**
   * The camera-space depth of the opaque scene for `camera`, or null until it
   * has been copied in the last few frames. Within a frame the copy lands
   * before any transparent mesh reads it.
   */
  textureFor(camera: Camera | null): RenderTargetTexture | null {
    return camera && camera === this.camera && this.engine.frameId - this.capturedFrame <= REQUEST_FRAMES
      ? this.viewZ
      : null;
  }

  /** The source's depth attachment format as a Babylon depth format, or 0 if a blit cannot copy it. */
  private formatOf(target: RenderTargetWrapper): number {
    const known = targetFormats.get(target);
    if (known !== undefined) return known;
    const gl = this.engine._gl!;
    const buffer = (target as unknown as { _depthStencilBuffer?: WebGLRenderbuffer | null })._depthStencilBuffer;
    if (!buffer) return 0;
    const bound = gl.getParameter(gl.RENDERBUFFER_BINDING) as WebGLRenderbuffer | null;
    gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
    const internal = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_INTERNAL_FORMAT) as number;
    gl.bindRenderbuffer(gl.RENDERBUFFER, bound);
    const format = BLIT_FORMATS[internal] ?? 0;
    targetFormats.set(target, format);
    return format;
  }

  private installHook(): void {
    const group = (this.scene.renderingManager as unknown as { _renderingGroups?: RenderingGroup[] })
      ._renderingGroups?.[0];
    if (!group || (group === this.hookedGroup && group.onBeforeTransparentRendering === this.hook)) return;
    this.unhook();
    this.previousHook = group.onBeforeTransparentRendering;
    group.onBeforeTransparentRendering = this.hook;
    this.hookedGroup = group;
  }

  private unhook(): void {
    if (this.hookedGroup?.onBeforeTransparentRendering === this.hook) {
      this.hookedGroup.onBeforeTransparentRendering = this.previousHook ?? (null as unknown as () => void);
    }
    this.hookedGroup = null;
    this.previousHook = null;
  }

  private capture(): void {
    const engine = this.engine;
    const camera = this.camera;
    if (!camera || this.scene.activeCamera !== camera) return;
    if (engine.frameId - this.requestedFrame > REQUEST_FRAMES) return;
    const source = this.mainTarget(camera);
    if (!source || engine._currentRenderTarget !== source) return;
    if (!this.prepare(source)) return;
    const gl = engine._gl!;
    const sourceFramebuffer = (source as unknown as { _framebuffer: WebGLFramebuffer })._framebuffer;
    const copyFramebuffer = (this.depthTarget as unknown as { _framebuffer: WebGLFramebuffer })._framebuffer;
    const { width, height } = source;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copyFramebuffer);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sourceFramebuffer);

    const effect = this.effect!;
    if (!effect.effect.isReady()) return;
    const alphaMode = engine.getAlphaMode();
    engine.setAlphaMode(Constants.ALPHA_DISABLE);
    this.effectRenderer!.render(effect, this.viewZ!);
    engine.setAlphaMode(alphaMode);
    // Back to the main target for the transparent meshes
    engine.bindFramebuffer(source);
    this.capturedFrame = engine.frameId;
  }

  /** Size the copies to `source`, building them on first use and again when it resizes in place. */
  private prepare(source: RenderTargetWrapper): boolean {
    const viewZ = this.viewZ;
    if (
      this.source === source &&
      viewZ &&
      this.depthTarget &&
      viewZ.getSize().width === source.width &&
      viewZ.getSize().height === source.height
    )
      return true;
    const format = this.formatOf(source);
    if (!format) return false;
    this.releaseTargets();
    const engine = this.engine;
    const size = { width: source.width, height: source.height };

    const depthTarget = engine.createRenderTargetTexture(size, {
      generateMipMaps: false,
      generateDepthBuffer: false,
      generateStencilBuffer: false,
      samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      label: "scene-depth-copy",
    });
    depthTarget.createDepthStencilTexture(0, false, false, 1, format, "scene-depth-copy");
    // Babylon makes the texture without attaching it; the blit writes through the attachment
    const gl = engine._gl!;
    const depthTexture = (depthTarget._depthStencilTexture as InternalTexture | null)?._hardwareTexture
      ?.underlyingResource as WebGLTexture | undefined;
    if (!depthTexture) {
      depthTarget.dispose();
      return false;
    }
    const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, (depthTarget as unknown as { _framebuffer: WebGLFramebuffer })._framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
    this.depthTarget = depthTarget;

    const caps = engine.getCaps();
    const type = caps.textureHalfFloatRender ? Constants.TEXTURETYPE_HALF_FLOAT : Constants.TEXTURETYPE_FLOAT;
    this.viewZ = new RenderTargetTexture("scene-depth-viewz", size, this.scene, {
      generateMipMaps: false,
      type,
      samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      generateDepthBuffer: false,
      generateStencilBuffer: false,
    });
    this.viewZ.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    this.viewZ.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;

    if (!this.effect) {
      Effect.ShadersStore.sceneDepthViewZVertexShader = VERTEX;
      Effect.ShadersStore.sceneDepthViewZFragmentShader = FRAGMENT;
      this.effectRenderer = new EffectRenderer(engine);
      this.effect = new EffectWrapper({
        engine,
        name: "sceneDepthViewZ",
        vertexShader: "sceneDepthViewZ",
        fragmentShader: "sceneDepthViewZ",
        useShaderStore: true,
        uniformNames: ["nearFar"],
        samplerNames: ["depthSampler"],
      });
      this.effect.onApplyObservable.add(() => {
        const camera = this.camera;
        const depth = this.depthTarget?._depthStencilTexture as InternalTexture | null | undefined;
        if (!camera || !depth) return;
        this.effect!.effect._bindTexture("depthSampler", depth);
        this.effect!.effect.setFloat2("nearFar", camera.minZ, camera.maxZ);
      });
    }
    this.source = source;
    return true;
  }

  private releaseTargets(): void {
    this.depthTarget?.dispose();
    this.depthTarget = null;
    this.viewZ?.dispose();
    this.viewZ = null;
    this.source = null;
  }

  private dispose(): void {
    this.unhook();
    this.releaseTargets();
    this.effect?.dispose();
    this.effect = null;
    this.effectRenderer?.dispose();
    this.effectRenderer = null;
    captures.delete(this.scene);
  }
}
