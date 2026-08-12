# UI Scaling

> Verified against <code>UIScale.ts</code> on 2026-08-06.

<code>UIScale</code> scales a 1920x1080 reference design by default. Modes are <code>fit</code>, <code>fill</code>, <code>width</code>, and <code>height</code>. Default scale limits are 0.4 to 2.5; the mobile breakpoint is 768 design pixels and the minimum touch target is 44 pixels.

Initialize once:

    UIScale.getInstance().init(optionalConfig);

Use <code>px()</code>/<code>css()</code> in code or generated CSS variables:

- <code>--ui-scale</code>, <code>--ui-scale-x</code>, <code>--ui-scale-y</code>;
- viewport/mobile/portrait indicators;
- <code>--ui-space-*</code>, <code>--ui-font-*</code>, <code>--ui-radius-*</code>;
- touch target and safe-area variables.

Utility classes hide content by mobile/desktop or portrait/landscape state. Resize and orientation changes are debounced. <code>onResize()</code> returns an unsubscribe function.

Debugging APIs are <code>forceScale()</code>, <code>setScaleMode()</code>, <code>toggleDebug()</code>, and <code>getDebugInfo()</code>. The <code>ui</code> console command exposes runtime UI controls; use its help for exact subcommands.

<code>CapacitorBridge</code> installs additional mobile CSS and safe-area properties on native/touch platforms. Test portrait, landscape, notches, pointer lock, and touch targets on a real WebView.
