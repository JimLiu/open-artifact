// Vite only serves the site here: `npm run dev` serves dist/ (rebuilt on change by scripts/dev.mjs, with live
// reload), and `npm run preview` serves the finished build. The pages themselves are rendered by scripts/build.mjs.
import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'mpa',
  base: process.env.SITE_BASE || '/',
  build: { outDir: 'dist' },
  preview: { port: 4322 },
});
