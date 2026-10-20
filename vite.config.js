import { defineConfig } from 'vite';

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
});
