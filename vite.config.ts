import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiDevServer } from './vite-api-plugin';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), apiDevServer()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Pre-bundle heavy deps once. (The Bolt template excluded lucide-react, which
  // made the browser fetch ~1,500 separate icon modules on every dev page load.)
  optimizeDeps: {
    include: ['lucide-react', '@hot-labs/near-connect', 'qrcode.react', 'react-router-dom'],
  },
  server: {
    // Transform the app entry up front so the first page load is quick.
    warmup: { clientFiles: ['./src/main.tsx', './src/App.tsx', './src/lib/api.ts'] },
  },
});
