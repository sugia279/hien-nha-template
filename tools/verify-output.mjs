import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import assert from 'node:assert/strict';
import { readSite, projectSite } from './site-data.mjs';
const root = process.cwd(),
  { site, hosting, posts, assets } = await projectSite(readSite(root));
const output = resolve(root, 'dist');
const files = readdirSync(output, { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile())
  .map((f) =>
    relative(output, resolve(f.parentPath, f.name)).replaceAll('\\', '/'),
  );
const expected = [
  'index.html',
  'search.json',
  'rss.xml',
  'sitemap.xml',
  ...(site.presentation.modules.includes('profile')
    ? ['profile/index.html']
    : []),
  ...posts.map((p) => 'posts/' + p.id + '/index.html'),
  ...assets,
];
assert.deepEqual(
  files.filter((f) => !/^_astro\/[a-zA-Z0-9_.-]+\.(?:css|js)$/.test(f)).sort(),
  expected.sort(),
  'Unexpected public output',
);
for (const file of files.filter((f) => /\.(?:html|json|xml|js|css)$/.test(f))) {
  const html = readFileSync(resolve(output, file), 'utf8');
  if (file.endsWith('.js'))
    assert(
      !/HIEN_NHA_SESSION_NONCE|X-Hien-Nha-Session|\/api\/(?:presentation|git-commit|git-push|preview-post)/i.test(
        html,
      ),
      'Private Studio code leaked into public JavaScript',
    );
  if (file.endsWith('.html'))
    assert(
      !/<meta[^>]+name=["']hien-nha-session["']/i.test(html),
      'Private Studio HTML leaked',
    );
  if (file.endsWith('.html'))
    assert(
      /<style(?:\s|>)|<link[^>]+rel=["']stylesheet["']/.test(html),
      'Built page is missing stylesheets',
    );
  assert(
    !/ONLY_ME_CANARY_|DRAFT_CANARY_|sb_secret_|github_pat_|hiens-nha/.test(
      html,
    ),
    'Forbidden public payload',
  );
  if (!file.endsWith('.html')) continue;
  for (const [, url] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (url.startsWith('https://')) {
      assert(url.startsWith(hosting.origin + hosting.base));
      continue;
    }
    assert(url.startsWith(hosting.base), 'Missing hosting base');
    const path = url.slice(hosting.base.length);
    assert(
      files.includes(
        path === '' || path.endsWith('/') ? path + 'index.html' : path,
      ),
      'Broken internal URL',
    );
  }
}
console.log(
  'Template public-only routes/assets and base checks passed:',
  files.length,
  'files',
);
