# Render Variables

> Verified against <code>RenderVars.ts</code> on 2026-08-06.

Render variables are registered as cvars, clamped to declared ranges, and persisted to <code>localStorage</code> key <code>engine.renderVars</code>. Debug variables do not persist.

| Category | Variables and defaults |
|---|---|
| Material | <code>r_deluxe 1</code>, <code>r_bsp_pbr 1</code>, <code>r_normalmap 1</code>, <code>r_glossmap 1</code>, <code>r_lightmap 1</code>, <code>r_emissive 1</code> |
| Texture | <code>r_anisotropy 8</code>, <code>r_ktx2 1</code> |
| Display | <code>r_webgpu 0</code>, <code>r_bsp_freeze 1</code>, <code>r_ssr 0</code>, <code>r_ssr_strength 0.4</code>, <code>r_glow 0</code>, <code>r_bloom 1</code>, <code>r_exposure 1</code>, <code>r_contrast 1</code>, <code>r_pickupProcedural 1</code> |
| Lighting | <code>r_ambient 1</code>, <code>r_lightintensity 1</code>, <code>r_lightmapscale 1</code>, god-ray and area-light groups, day/night group |
| Debug | <code>r_wireframe 0</code>, <code>r_showtris 0</code> |

God rays: <code>r_godrays</code>, <code>r_godrays_exposure</code>, <code>r_godrays_decay</code>, <code>r_godrays_weight</code>, <code>r_godrays_density</code>, <code>r_godrays_samples</code>.

Area lights: <code>r_arealights</code>, <code>r_arealights_max</code>, <code>r_arealights_auto</code>, <code>r_arealights_intensity</code>.

Day/night: <code>r_daynight</code>, <code>r_daynight_time</code>, <code>r_daynight_animate</code>, <code>r_daynight_speed</code>, <code>r_daynight_length</code>, <code>r_daynight_lm_min</code>, <code>r_daynight_lm_max</code>, <code>r_daynight_sun_intensity</code>, <code>r_daynight_moon_intensity</code>, <code>r_daynight_sky_tint</code>.

Use <code>cvarlist r_</code>, direct <code>r_name [value]</code>, <code>help r_name</code>, <code>reset</code>, <code>render list</code>, and <code>render export</code>.

Some values apply live; deluxe/PBR selection, KTX2, WebGPU, BSP freeze, area lights, pickup visuals, and some quality settings require a new load, activation, or restart as their descriptions state.

Type-only future names such as gamma, saturation, picmip, shadows, and normal/lightmap debug views are not registered defaults and must not be documented as available cvars.
