import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    host: true, // Allow external access for Capacitor live reload
  },
  assetsInclude: ['**/*.pk3'], // Treat PK3 files as static assets
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Optimize chunk splitting for mobile
    rollupOptions: {
      output: {
        manualChunks: {
          babylon: ['babylonjs', 'babylonjs-loaders'],
        },
      },
    },
  },
});
