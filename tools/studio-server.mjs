import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { extname, resolve, relative, isAbsolute } from 'node:path';
import { safePath } from './files.mjs';
import { createStudioStore, StudioError } from './studio-store.mjs';
import { createStudioGit } from './studio-git.mjs';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
};
export function codespaceOrigin(env, port) {
  if (env.CODESPACES !== 'true') return null;
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(env.CODESPACE_NAME || '') ||
    env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN !== 'app.github.dev'
  )
    throw new Error('Unsupported Codespaces forwarding environment');
  return 'https://' + env.CODESPACE_NAME + '-' + port + '.app.github.dev';
}
export function createStudioServer(directory, options = {}) {
  codespaceOrigin(options.env || process.env, 4447);
  const store = createStudioStore(directory, options.storeOptions);
  const git = createStudioGit(store, options.gitOptions);
  const nonce = randomBytes(32).toString('hex');
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 10_000 },
    async (req, res) => {
      const port = server.address().port;
      const external = codespaceOrigin(options.env || process.env, port);
      const origins = [
        'http://127.0.0.1:' + port,
        'http://localhost:' + port,
        ...(external ? [external] : []),
      ];
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'X-Hien-Nha-Workspace',
        createHash('sha256').update(store.root).digest('hex'),
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
      );
      function json(status, value) {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(value));
      }
      try {
        if (
          !origins.some(
            (origin) => new URL(origin).host === req.headers.host,
          ) ||
          (req.headers.origin && !origins.includes(req.headers.origin)) ||
          req.headers['sec-fetch-site'] === 'cross-site'
        )
          throw new StudioError(403, 'Request origin rejected');
        if (!['GET', 'POST'].includes(req.method))
          throw new StudioError(405, 'Method not supported');
        const url = new URL(req.url, 'http://studio.invalid');
        if (
          url.search ||
          req.url.includes('\\') ||
          /%(?:2e|2f|5c)/i.test(req.url)
        )
          throw new StudioError(400, 'Invalid request path');
        if (url.pathname.startsWith('/api/')) {
          const supplied = req.headers['x-hien-nha-session'];
          if (
            typeof supplied !== 'string' ||
            supplied.length !== nonce.length ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(nonce))
          )
            throw new StudioError(403, 'Studio session required');
          if (req.method === 'GET' && url.pathname === '/api/state')
            return json(200, store.state());
          if (req.method === 'GET' && url.pathname === '/api/git-status')
            return json(200, await git.status());
          const operations = {
            '/api/presentation': store.savePresentation,
            '/api/hosting': store.saveHosting,
            '/api/upload': store.upload,
            '/api/preview': store.preview,
            '/api/content': store.saveContent,
            '/api/import': store.importContent,
            '/api/preview-post': store.previewPost,
            '/api/publication': store.savePublication,
            '/api/git-commit': git.commit,
            '/api/git-push': git.push,
          };
          const operation = operations[url.pathname];
          if (req.method !== 'POST' || !operation)
            throw new StudioError(404, 'Unknown operation');
          if (!origins.includes(req.headers.origin))
            throw new StudioError(403, 'Write origin required');
          if (req.headers['content-type'] !== 'application/json')
            throw new StudioError(415, 'JSON request required');
          const limit =
            url.pathname === '/api/upload'
              ? 7_000_000
              : ['/api/content', '/api/import', '/api/preview-post'].includes(
                    url.pathname,
                  )
                ? 4_100_000
                : 70_000;
          if (Number(req.headers['content-length']) > limit)
            throw new StudioError(413, 'Request is too large');
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > limit)
              throw new StudioError(413, 'Request is too large');
            chunks.push(chunk);
          }
          let body;
          try {
            body = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(
                Buffer.concat(chunks),
              ),
            );
          } catch {
            throw new StudioError(400, 'Invalid JSON request');
          }
          return json(200, await operation(body));
        }
        if (req.method !== 'GET')
          throw new StudioError(405, 'Method not supported');
        let root,
          logical,
          ownerHtml = false;
        if (url.pathname.startsWith('/preview/')) {
          const preview = store.getPreview();
          const prefix = preview && '/preview/' + preview.id + '/';
          if (!prefix || !url.pathname.startsWith(prefix))
            throw new StudioError(404, 'Preview not available');
          root = preview.output;
          logical = url.pathname.slice(prefix.length);
          if (!logical || logical.endsWith('/')) logical += 'index.html';
          res.setHeader('X-Robots-Tag', 'noindex, nofollow');
          res.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; frame-ancestors 'self'; sandbox allow-same-origin; base-uri 'none'",
          );
        } else if (url.pathname.startsWith('/assets/')) {
          root = store.root;
          logical = 'content/assets/' + url.pathname.slice('/assets/'.length);
          if (
            !['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(
              extname(logical),
            )
          )
            throw new StudioError(404, 'Image not available');
        } else {
          root = safePath(store.root, '.hien-nha/studio');
          logical = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          if (
            logical !== 'index.html' &&
            !/^_astro\/[A-Za-z0-9_.-]+\.(?:css|js)$/.test(logical)
          )
            throw new StudioError(404, 'Page not available');
          ownerHtml = logical === 'index.html';
        }
        const target = safePath(root, logical),
          info = lstatSync(target);
        const rel = relative(root, resolve(target));
        if (
          isAbsolute(rel) ||
          rel.startsWith('..') ||
          !info.isFile() ||
          info.size > 6_000_000 ||
          !mime[extname(target)]
        )
          throw new StudioError(404, 'File not available');
        let bytes = readFileSync(target);
        if (ownerHtml)
          bytes = Buffer.from(
            bytes.toString('utf8').replace('HIEN_NHA_SESSION_NONCE', nonce),
          );
        res.writeHead(200, { 'Content-Type': mime[extname(target)] });
        res.end(bytes);
      } catch (error) {
        if (!res.headersSent)
          json(error instanceof StudioError ? error.status : 422, {
            error:
              error instanceof StudioError
                ? error.message
                : 'Request validation or file operation failed. Check saved files before retrying.',
          });
        else res.end();
      }
    },
  );
  server.keepAliveTimeout = 5000;
  return { server, store };
}
