import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';

const here = import.meta.dirname;
const repo = resolve(here, '../..');

export default defineConfig({
  root: join(here, 'renderer'),
  cacheDir: join(here, 'node_modules/.vite'),
  plugins: [react(), tailwind()],
  resolve: {
    // Workspace components must use the renderer's React too.
    alias: Object.fromEntries(['react', 'react-dom', 'scheduler'].map((name) => [name, join(here, 'node_modules', name)])),
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    fs: { allow: [repo] },
    watch: { ignoreInitial: true, ignored: ['**/out/**', '**/dist/**', '**/resources/**', '**/vendor/**', '**/.desktop-dev/**', '**/artifact-types/*/scripts/**'] },
  },
});
