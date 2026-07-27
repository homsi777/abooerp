import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const devPorts = JSON.parse(
  readFileSync(join(__dirname, 'config', 'dev-ports.json'), 'utf-8'),
) as { api: number; vite: number };

export default defineConfig({
  // Required for Electron packaged app — file:// needs relative asset paths
  base: './',
  build: {
    target: 'esnext',
  },
  server: {
    // 0.0.0.0 — يسمح بالوصول من شبكة LAN (أجهزة أخرى على نفس الروتر)
    // wait-on يعمل عبر tcp:127.0.0.1 لأن 0.0.0.0 يشمل 127.0.0.1 تلقائياً
    host: '0.0.0.0',
    port: devPorts.vite,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${devPorts.api || 4010}`,
        changeOrigin: true,
      },
    },
  },
});
