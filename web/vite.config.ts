import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': src('app'),
      '@pages': src('pages'),
      '@widgets': src('widgets'),
      '@features': src('features'),
      '@shared': src('shared'),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5055' },
  },
  build: { outDir: '../public', emptyOutDir: true },
});
