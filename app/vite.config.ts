import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// Tauri drives the dev server; fail loudly rather than silently picking another port.
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    host: '127.0.0.1',
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
