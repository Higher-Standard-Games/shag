import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  server: {
    port: 3000,
    host: true, // Allow external access for Capacitor live reload
  },
  assetsInclude: ['**/*.pk3'], // Treat PK3 files as static assets
  // ES6 @babylonjs packages used directly - no alias needed for tree-shaking
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Target modern browsers only (smaller output, no legacy polyfills)
    target: 'es2020',
    // Disable source maps in production (saves ~30-50% of JS size)
    sourcemap: false,
    // Minification settings
    minify: 'esbuild',
    cssMinify: true,
    // Optimize chunk splitting for mobile
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Babylon.js - core 3D engine (ES6 modules for tree-shaking)
          if (id.includes('node_modules/@babylonjs')) {
            return 'babylon';
          }
          // JSZip - PK3 archive handling
          if (id.includes('node_modules/jszip')) {
            return 'jszip';
          }
          // Capacitor - mobile platform bridge
          if (id.includes('node_modules/@capacitor')) {
            return 'capacitor';
          }
          // Keep other node_modules in vendor chunk
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
      plugins: [
        visualizer({
          filename: 'dist/stats.html',
          open: false,
          gzipSize: true,
          brotliSize: true,
        }),
      ],
    },
  },
});
