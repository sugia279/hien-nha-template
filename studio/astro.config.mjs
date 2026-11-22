import { defineConfig } from 'astro/config';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
const root = realpathSync.native(process.cwd());
export default defineConfig({
  root,
  srcDir: resolve(root, 'studio/src'),
  publicDir: resolve(root, 'studio/public'),
  outDir: resolve(root, '.hien-nha/studio'),
  cacheDir: resolve(root, 'node_modules/.astro-studio'),
  output: 'static',
  build: { inlineStylesheets: 'always' },
  vite: { build: { sourcemap: false } },
});
