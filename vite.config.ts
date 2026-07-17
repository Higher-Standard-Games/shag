import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import * as path from 'path';
import * as fs from 'fs';

// Read engine.json for default game configuration
const engineConfigPath = path.resolve(__dirname, 'public/engine.json');
const engineConfig = JSON.parse(fs.readFileSync(engineConfigPath, 'utf-8'));

// GAME env var overrides engine.json's defaultGame (for development/testing)
const selectedGame = process.env.GAME || engineConfig.defaultGame || 'default';
console.log(`[Vite] Building game: ${selectedGame}`);

export default defineConfig({
  resolve: {
    alias: {
      '@game': path.resolve(__dirname, `src/games/${selectedGame}`),
      '@engine/server': path.resolve(__dirname, 'src/engine/server'),
      '@shared/server': path.resolve(__dirname, 'src/shared/server'),
      '@games/fps/server': path.resolve(__dirname, 'src/games/fps/server'),
    },
  },
  server: {
    port: 3000,
    host: true, // Allow external access for Capacitor live reload
  },
  // Strip log/debug console calls from PRODUCTION bundles as pure (QA-15):
  // pure annotations only take effect at minify time, so dev keeps every log.
  // console.warn / console.error always survive — they are the diagnostics.
  esbuild: {
    pure: ['console.log', 'console.debug'],
  },
  assetsInclude: ['**/*.pk3'], // Treat PK3 files as static assets
  // ES6 @babylonjs packages used directly - no alias needed for tree-shaking
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Target modern browsers only (smaller output, no legacy polyfills)
    target: 'es2020',
    // Hidden source maps (QA-15): .map files are emitted for CI/error
    // symbolication but bundles carry no sourceMappingURL comment.
    // NOTE: deploys must exclude *.map from the public upload — the files
    // exist in dist/ even though browsers are never pointed at them.
    sourcemap: 'hidden',
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
