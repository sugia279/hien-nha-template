import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { parseSiteConfig, parseHostingConfig } from '@hien-nha/core-config';
import { parseContentDocument } from '@hien-nha/core-domain';
import {
  createStaticContentAdapter,
  readPublicContent,
} from '@hien-nha/core-client';
import { safePath, readJson, resetGenerated } from './files.mjs';
import { createPublicIndexes } from './public-indexes.mjs';

export function readSite(root) {
  const site = parseSiteConfig(readJson(root, 'site.config.json'));
  const hosting = parseHostingConfig(
    readJson(root, 'hosting.config.json', 4096),
  );
  const content = parseContentDocument(
    readJson(root, 'content/posts.json', 2_000_000),
  );
  if (content.siteId !== site.id) throw Error('Content/site mismatch');
  return { site, hosting, content };
}
export function validRaster(bytes, extension) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > 5_242_880)
    return false;
  if (extension === '.png')
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg')
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (extension === '.webp')
    return (
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP'
    );
  if (extension === '.avif')
    return (
      bytes.toString('ascii', 4, 8) === 'ftyp' &&
      ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))
    );
  return false;
}
export async function projectSite(input) {
  const site = parseSiteConfig(input.site),
    hosting = parseHostingConfig(input.hosting),
    content = parseContentDocument(input.content);
  if (content.siteId !== site.id) throw Error('Content/site mismatch');
  for (const path of [
    ...content.posts.map((p) => p.id),
    ...content.posts.flatMap((p) => p.media.map((m) => m.path)),
    site.presentation.profile.avatar?.path,
    site.presentation.banner.image?.path,
  ].filter(Boolean))
    if (
      path
        .split('/')
        .some((part) =>
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    )
      throw Error('Template paths must be portable across operating systems');
  const snapshot = await readPublicContent(
    createStaticContentAdapter(site.id, content),
    site.id,
  );
  const enabled = site.presentation.modules.includes('posts');
  const posts = enabled ? snapshot.posts : [];
  const presentation = [
    site.presentation.profile.avatar,
    site.presentation.banner.image,
  ]
    .filter(Boolean)
    .map((image) => image.path);
  const hidden = new Set(
    content.posts
      .filter((p) => p.visibility !== 'PUBLIC' || !p.published)
      .flatMap((p) => p.media.map((m) => m.path)),
  );
  if (presentation.some((path) => hidden.has(path)))
    throw Error('Hidden/draft media cannot be used in public presentation');
  const assets = [
    ...new Set([...presentation, ...(enabled ? snapshot.assets : [])]),
  ];
  return { site, hosting, posts, assets };
}
export function readSelectedAssets(sourceRoot, data) {
  let total = 0;
  return data.assets.map((path) => {
    const source = safePath(sourceRoot, 'content/assets/' + path),
      info = lstatSync(source);
    if (!info.isFile() || info.size > 5_242_880)
      throw Error('Invalid public image file');
    const bytes = readFileSync(source);
    total += bytes.length;
    if (total > 20_971_520 || !validRaster(bytes, extname(path)))
      throw Error('Public images require supported raster bytes within limits');
    return { path, bytes };
  });
}
export async function prepareSite(sourceRoot, outputRoot = sourceRoot) {
  const data = await projectSite(readSite(sourceRoot));
  // Read and validate all selected bytes before changing generated output.
  const assets = readSelectedAssets(sourceRoot, data);
  const indexes = createPublicIndexes(data);
  const generated = resetGenerated(outputRoot);
  mkdirSync(resolve(generated, 'public'));
  for (const [name, text] of Object.entries(indexes))
    writeFileSync(safePath(outputRoot, '.generated/public/' + name), text);
  for (const { path, bytes } of assets) {
    const target = safePath(outputRoot, '.generated/public/' + path, true);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  writeFileSync(
    resolve(generated, 'public-data.json'),
    JSON.stringify(data, null, 2) + '\n',
  );
  return data;
}
