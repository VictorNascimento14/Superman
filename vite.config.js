import { defineConfig } from 'vite';

// base relativo: o mesmo build serve em / (dev) e em /Superman/ (GitHub Pages).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
