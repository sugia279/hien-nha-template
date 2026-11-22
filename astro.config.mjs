import { defineConfig } from 'astro/config';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { prepareSite } from './tools/site-data.mjs';
const project = realpathSync.native(process.cwd());
const source = realpathSync.native(
  resolve(process.env.HIEN_NHA_SOURCE_DIR || project),
);
const output = realpathSync.native(
  resolve(process.env.HIEN_NHA_OUTPUT_DIR || project),
);
const { hosting } = await prepareSite(source, output);
export default defineConfig({
  root: project,
  site: hosting.origin,
  base: hosting.base,
  output: 'static',
  trailingSlash: 'always',
  // Small static pages keep their styles with the document across hosting paths.
  build: { inlineStylesheets: 'always' },
  publicDir: resolve(output, '.generated/public'),
  outDir: resolve(output, 'dist'),
  vite: { build: { sourcemap: false } },
});
