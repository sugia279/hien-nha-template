import { parseSiteConfig, parseHostingConfig } from '@hien-nha/core-config';
import {
  parsePublicPosts,
  publicAssets,
  serializePublicSnapshot,
} from '@hien-nha/core-domain';
export function xml(value) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(
      /[<>&"']/g,
      (c) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&apos;',
        })[c],
    );
}
export function createPublicIndexes(input) {
  const site = parseSiteConfig(input.site),
    hosting = parseHostingConfig(input.hosting);
  const validated = parsePublicPosts(input.posts);
  const posts = site.presentation.modules.includes('posts') ? validated : [];
  const root = hosting.origin + hosting.base,
    url = (id) => root + 'posts/' + id + '/';
  const search = serializePublicSnapshot({
    schemaVersion: 1,
    siteId: site.id,
    posts,
    assets: publicAssets(posts),
  });
  const rss =
    '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>' +
    xml(site.presentation.name) +
    '</title><link>' +
    xml(root) +
    '</link><description>' +
    xml(site.presentation.tagline) +
    '</description><language>' +
    site.presentation.locale +
    '</language>' +
    posts
      .map(
        (p) =>
          '<item><title>' +
          xml(p.title) +
          '</title><link>' +
          xml(url(p.id)) +
          '</link><guid isPermaLink="true">' +
          xml(url(p.id)) +
          '</guid><description>' +
          xml(p.body) +
          '</description></item>',
      )
      .join('') +
    '</channel></rss>\n';
  const urls = [
    root,
    ...(site.presentation.modules.includes('profile')
      ? [root + 'profile/']
      : []),
    ...posts.map((p) => url(p.id)),
  ];
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map((u) => '<url><loc>' + xml(u) + '</loc></url>').join('') +
    '</urlset>\n';
  return { 'search.json': search, 'rss.xml': rss, 'sitemap.xml': sitemap };
}
