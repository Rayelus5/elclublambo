import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the game server under /galaxy/ (GDD §18.1). In dev, the API is proxied to the server on :8080.
export default defineConfig({
  base: '/galaxy/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: { '/galaxy/api': 'http://localhost:8080' } },
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: true },
});
