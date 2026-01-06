import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  server: {
    port: 3000,
    host: true, // Allow external access for Capacitor live reload
  },
  assetsInclude: ['**/*.pk3'], // Treat PK3 files as static assets
  resolve: {
    alias: {
      // Redirect @babylonjs/core to babylonjs to avoid bundling both
      '@babylonjs/core': 'babylonjs',
      '@babylonjs/loaders': 'babylonjs-loaders',
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Optimize chunk splitting for mobile
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Babylon.js - core 3D engine
          if (id.includes('node_modules/babylonjs')) {
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
