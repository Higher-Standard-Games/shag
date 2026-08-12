# Post-processing

> Verified against <code>PostProcessingManager.ts</code> on 2026-08-06.

<code>PostProcessingManager</code> owns Babylon's HDR <code>DefaultRenderingPipeline</code> and an optional <code>SSAO2RenderingPipeline</code>.

| Effect | Default |
|---|---|
| Master pipeline | enabled |
| Bloom | enabled; threshold 0.8, weight 0.3, half-resolution |
| Color/image processing | enabled; contrast 1.05, exposure 1 |
| Vignette | enabled; weight 0.3 |
| SSAO2 | disabled |
| Chromatic aberration | disabled |

The manager also initializes the cel-outline post-process and rebinds pipelines when the active camera changes. It listens to clock ticks to modulate night/dawn/dusk exposure.

Initialize with the scene and active camera, update settings through the manager, and call <code>dispose()</code> at scene teardown. Scene services reset the singleton on a rebuild.

Current lifecycle caveat: <code>dispose()</code> removes the camera-change subscription, but the <code>clock:tick</code> subscription created during initialization is not retained or removed. Repeated scene rebuilds can therefore leave stale listeners until that implementation is fixed.

Render cvars <code>r_bloom</code>, <code>r_exposure</code>, and <code>r_contrast</code> multiply the manager's captured baseline. <code>r_glow</code> and <code>r_ssr</code> control separate scene services.

Developer command <code>pp</code> exposes bloom, exposure, and contrast. Its completion also lists saturation/vignette, but those cvars are not currently registered by <code>RenderVars</code>; runtime help/cvar existence remains authoritative.

SSAO, SSR, bloom, glow, and chromatic aberration have real GPU cost. Test quality and camera rebinding in the browser after headless regression checks.
