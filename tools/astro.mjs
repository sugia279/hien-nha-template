import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Normalize before Astro/Vite initialize module IDs (Windows short paths/junctions).
const project = realpathSync.native(
  fileURLToPath(new URL('../', import.meta.url)),
);
process.chdir(project);
process.env.ASTRO_TELEMETRY_DISABLED = '1';
process.argv[1] = resolve(project, 'node_modules/astro/bin/astro.mjs');
await import(pathToFileURL(process.argv[1]).href);
