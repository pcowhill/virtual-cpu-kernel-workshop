import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Served from https://<owner>.github.io/virtual-cpu-kernel-workshop/ on GitHub Pages.
// BASE_PATH can override it (e.g. "/" for local preview).
const base = process.env.BASE_PATH ?? '/virtual-cpu-kernel-workshop/';

export default defineConfig({
  base,
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
