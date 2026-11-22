import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
  existsSync,
  realpathSync,
  rmSync,
  lstatSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import {
  parseContentDocument,
  parseContentJson,
  importLegacyPosts,
  serializeContentDocument,
} from '@hien-nha/core-domain';
import { StudioError, strictKeys } from './studio-contract.mjs';
export { StudioError, strictKeys } from './studio-contract.mjs';
import {
  updatePresentation,
  serializeSiteConfig,
  parseHostingConfig,
  serializeHostingConfig,
} from '@hien-nha/core-config';
import { safePath, readJson } from './files.mjs';
import {
  readSite,
  projectSite,
  readSelectedAssets,
  validRaster,
} from './site-data.mjs';

const documents = [
  'site.config.json',
  'hosting.config.json',
  'content/posts.json',
  'publication.config.json',
];
export function createStudioStore(directory, options = {}) {
  const root = realpathSync.native(directory);
  const internal = safePath(root, '.hien-nha');
  if (!existsSync(internal)) mkdirSync(internal);
  let activePreview = null,
    previewBusy = false;
  function removePreview(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid preview identifier');
    const target = safePath(root, '.hien-nha/previews/' + id);
    // safePath checks containment and every existing segment before recursive removal.
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
  function snapshot() {
    const raw = documents.map((path) => {
      const file = safePath(root, path),
        info = lstatSync(file);
      const limit =
        path === 'content/posts.json'
          ? 2_000_000
          : path === 'site.config.json'
            ? 65_536
            : 4096;
      if (!info.isFile() || info.size > limit)
        throw new StudioError(422, 'Invalid or oversized source document');
      return readFileSync(file);
    });
    const revision = createHash('sha256')
      .update(JSON.stringify(raw.map((b) => b.toString('base64'))))
      .digest('hex');
    const state = readSite(root);
    const publication = readJson(root, 'publication.config.json', 4096);
    strictKeys(publication, ['schemaVersion', 'enabled']);
    if (
      publication.schemaVersion !== 1 ||
      typeof publication.enabled !== 'boolean'
    )
      throw new StudioError(422, 'Unsupported publication configuration');
    return { ...state, publication, revision, raw };
  }
  function state() {
    const { raw, ...value } = snapshot();
    void raw;
    let coreVersion = '0.1.1';
    if (existsSync(safePath(root, 'core.lock.json'))) {
      const pin = readJson(root, 'core.lock.json');
      if (
        typeof pin.version === 'string' &&
        /^\d+\.\d+\.\d+$/.test(pin.version)
      )
        coreVersion = pin.version;
    }
    return { ...value, coreVersion };
  }
  function requireRevision(current, revision) {
    if (typeof revision !== 'string' || revision !== current.revision)
      throw new StudioError(
        409,
        'Files changed. Reload saved files before applying your draft.',
      );
  }
  async function candidate(presentation, revision) {
    const current = snapshot();
    requireRevision(current, revision);
    const result = updatePresentation(current.site, presentation);
    if (!result.success)
      throw new StudioError(422, 'Invalid presentation configuration');
    const data = await projectSite({ ...current, site: result.data });
    const assets = readSelectedAssets(root, data);
    requireRevision(snapshot(), revision);
    return { current, site: result.data, assets };
  }
  async function withLock(revision, action) {
    const lock = safePath(root, '.hien-nha/write.lock');
    let handle;
    try {
      handle = openSync(lock, 'wx');
    } catch {
      throw new StudioError(
        409,
        'Another save or a stale workspace lock exists.',
      );
    }
    try {
      const current = snapshot();
      requireRevision(current, revision);
      return await action(current, () => requireRevision(snapshot(), revision));
    } finally {
      closeSync(handle);
      unlinkSync(lock);
    }
  }
  async function replace(path, revision, validate) {
    return withLock(revision, async (current, recheck) => {
      let temporary;
      try {
        const text = await validate(current);
        recheck();
        const backups = safePath(root, '.hien-nha/backups');
        if (!existsSync(backups)) mkdirSync(backups);
        const id = randomUUID();
        writeFileSync(
          safePath(root, '.hien-nha/backups/' + id + '.json'),
          current.raw[documents.indexOf(path)],
          { flag: 'wx', mode: 0o600 },
        );
        temporary = safePath(root, '.hien-nha/save-' + id + '.json');
        writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
        // Fixed target, same filesystem. Failure leaves original and backup bytes intact.
        renameSync(temporary, safePath(root, path));
        temporary = undefined;
        return state();
      } finally {
        if (temporary && existsSync(temporary)) unlinkSync(temporary);
      }
    });
  }
  async function savePresentation(body) {
    strictKeys(body, ['revision', 'presentation']);
    return replace('site.config.json', body.revision, async () => {
      const { site } = await candidate(body.presentation, body.revision);
      return serializeSiteConfig(site);
    });
  }
  async function saveHosting(body) {
    strictKeys(body, ['revision', 'hosting']);
    return replace('hosting.config.json', body.revision, () =>
      serializeHostingConfig(parseHostingConfig(body.hosting)),
    );
  }
  async function contentCandidate(input, revision) {
    const current = snapshot();
    requireRevision(current, revision);
    const content = parseContentDocument(input);
    const data = await projectSite({ ...current, content });
    // Validate hidden/draft references too, without retaining an unbounded image set.
    const paths = [
      ...new Set(content.posts.flatMap((p) => p.media.map((m) => m.path))),
    ];
    for (const path of paths) readSelectedAssets(root, { assets: [path] });
    readSelectedAssets(root, data);
    requireRevision(snapshot(), revision);
    return { current, content };
  }
  async function saveContent(body) {
    strictKeys(body, ['revision', 'content', 'acknowledgeGitDisclosure']);
    return replace('content/posts.json', body.revision, async () => {
      const { content } = await contentCandidate(body.content, body.revision);
      if (
        typeof body.acknowledgeGitDisclosure !== 'boolean' ||
        (content.posts.some(
          (p) => p.visibility === 'ONLY_ME' || !p.published,
        ) &&
          body.acknowledgeGitDisclosure !== true)
      )
        throw new StudioError(
          422,
          'Confirm that ONLY_ME and drafts remain readable in public Git source/history.',
        );
      return serializeContentDocument(content);
    });
  }
  async function importContent(body) {
    strictKeys(body, ['revision', 'format', 'json']);
    if (
      typeof body.json !== 'string' ||
      Buffer.byteLength(body.json) > 2_000_000
    )
      throw new StudioError(422, 'Import exceeds the JSON limit');
    const current = snapshot();
    requireRevision(current, body.revision);
    let content;
    if (body.format === 'current') content = parseContentJson(body.json);
    else if (body.format === 'legacy')
      content = importLegacyPosts(current.site.id, JSON.parse(body.json));
    else throw new StudioError(422, 'Select an explicit import format');
    await contentCandidate(content, body.revision);
    return {
      content,
      revision: current.revision,
      migrated: body.format === 'legacy',
    };
  }
  async function savePublication(body) {
    strictKeys(body, ['revision', 'enabled', 'acknowledgePublication']);
    if (
      typeof body.enabled !== 'boolean' ||
      body.acknowledgePublication !== true
    )
      throw new StudioError(422, 'Confirm the explicit publication choice');
    return replace(
      'publication.config.json',
      body.revision,
      () =>
        JSON.stringify({ schemaVersion: 1, enabled: body.enabled }, null, 2) +
        '\n',
    );
  }
  async function upload(body) {
    strictKeys(body, ['extension', 'base64']);
    if (
      typeof body.base64 !== 'string' ||
      body.base64.length > 6_990_508 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        body.base64,
      )
    )
      throw new StudioError(422, 'Invalid image encoding');
    const bytes = Buffer.from(body.base64, 'base64');
    if (!validRaster(bytes, body.extension))
      throw new StudioError(422, 'Use a supported raster image up to 5 MiB');
    let image;
    try {
      image = await sharp(bytes, {
        limitInputPixels: 40_000_000,
        failOn: 'warning',
      })
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new StudioError(
        422,
        'Image could not be decoded within the limits',
      );
    }
    if (image.length > 5_242_880)
      throw new StudioError(422, 'Converted image exceeds the limit');
    const path =
      'media/image-' +
      createHash('sha256').update(image).digest('hex') +
      '.webp';
    const target = safePath(root, 'content/assets/' + path, true);
    if (existsSync(target)) {
      if (!readFileSync(target).equals(image))
        throw new StudioError(409, 'Image path already exists');
    } else writeFileSync(target, image, { flag: 'wx' });
    return { path };
  }
  async function preview(body, ownerPost = false) {
    strictKeys(
      body,
      ownerPost
        ? ['revision', 'content', 'postId']
        : ['revision', 'presentation'],
    );
    if (previewBusy)
      throw new StudioError(409, 'A preview is already building');
    previewBusy = true;
    let created;
    try {
      let current, site, assets, previewContent;
      if (ownerPost) {
        const checked = await contentCandidate(body.content, body.revision);
        current = checked.current;
        site = current.site;
        const post = checked.content.posts.find((p) => p.id === body.postId);
        if (!post) throw new StudioError(422, 'Select a valid post');
        previewContent = {
          ...checked.content,
          posts: [{ ...post, visibility: 'PUBLIC', published: true }],
        };
        // Private one-post preview, even when the public Posts module is disabled.
        site = structuredClone(site);
        if (!site.presentation.modules.includes('posts'))
          site.presentation.modules.push('posts');
        assets = readSelectedAssets(
          root,
          await projectSite({ ...current, site, content: previewContent }),
        );
      } else {
        ({ current, site, assets } = await candidate(
          body.presentation,
          body.revision,
        ));
        previewContent = current.content;
      }
      const id = randomUUID(),
        logical = '.hien-nha/previews/' + id;
      created = id;
      const directory = safePath(
        root,
        logical + '/source/site.config.json',
        true,
      );
      writeFileSync(directory, serializeSiteConfig(site));
      writeFileSync(
        safePath(root, logical + '/source/hosting.config.json'),
        JSON.stringify({
          schemaVersion: 1,
          origin: 'https://preview.example.test',
          base: '/preview/' + id + '/',
        }),
      );
      const contentPath = safePath(
        root,
        logical + '/source/content/posts.json',
        true,
      );
      writeFileSync(contentPath, JSON.stringify(previewContent));
      for (const asset of assets)
        writeFileSync(
          safePath(
            root,
            logical + '/source/content/assets/' + asset.path,
            true,
          ),
          asset.bytes,
        );
      const output = safePath(root, logical + '/output');
      mkdirSync(output);
      if (options.buildPreview)
        await options.buildPreview({
          root,
          source: dirname(directory),
          output,
        });
      else
        await buildAstro(root, ['build'], {
          HIEN_NHA_SOURCE_DIR: dirname(directory),
          HIEN_NHA_OUTPUT_DIR: output,
          HIEN_NHA_OWNER_PREVIEW: '1',
        });
      const previewHtml = readFileSync(
        safePath(root, logical + '/output/dist/index.html'),
        'utf8',
      );
      if (!/<style(?:\s|>)|<link[^>]+rel=["']stylesheet["']/.test(previewHtml))
        throw new StudioError(
          422,
          'Preview styles are missing; saved files are unchanged',
        );
      const previous = activePreview;
      activePreview = { id, output: safePath(root, logical + '/output/dist') };
      created = undefined;
      if (previous) {
        try {
          removePreview(previous.id);
        } catch {
          /* Locked files may be cleaned after stopping Studio. */
        }
      }
      return {
        url:
          '/preview/' +
          id +
          '/' +
          (ownerPost ? 'posts/' + body.postId + '/' : ''),
        revision: current.revision,
      };
    } finally {
      if (created) {
        try {
          removePreview(created);
        } catch {
          /* Retain failed temporary output if locked. */
        }
      }
      previewBusy = false;
    }
  }
  return {
    root,
    state,
    savePresentation,
    saveHosting,
    saveContent,
    importContent,
    savePublication,
    withLock,
    validateContent: contentCandidate,
    upload,
    preview,
    previewPost: (body) => preview(body, true),
    getPreview: () => activePreview,
  };
}
export function buildAstro(root, args, extra = {}) {
  return new Promise((resolveBuild, reject) => {
    // Preview compiler needs no Git/provider credentials or arbitrary PUBLIC_* environment.
    const env = Object.fromEntries(
      [
        'PATH',
        'Path',
        'SystemRoot',
        'TEMP',
        'TMP',
        'HOME',
        'USERPROFILE',
        'APPDATA',
        'LOCALAPPDATA',
      ]
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]]),
    );
    const child = spawn(
      process.execPath,
      [resolve(root, 'tools/astro.mjs'), ...args],
      {
        cwd: root,
        env: { ...env, ASTRO_TELEMETRY_DISABLED: '1', ...extra },
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    const timeout = setTimeout(() => child.kill(), 120_000);
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new StudioError(422, 'Preview compiler could not start'));
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveBuild();
      else
        reject(
          new StudioError(
            422,
            'Preview build failed; saved files are unchanged',
          ),
        );
    });
  });
}
