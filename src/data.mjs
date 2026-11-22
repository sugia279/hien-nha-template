import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export const ownerPreview = process.env.HIEN_NHA_OWNER_PREVIEW === '1';
// This build-only module reads a whitelist projection, never raw content.
export const data = JSON.parse(
  readFileSync(
    resolve(
      process.env.HIEN_NHA_OUTPUT_DIR || process.cwd(),
      '.generated/public-data.json',
    ),
    'utf8',
  ),
);
