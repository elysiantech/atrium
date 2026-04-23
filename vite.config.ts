import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, proxy /api/* to the Node server (npm run api, :3001).
// In prod we don't use vite preview — server.ts serves dist/ + /api/*.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
