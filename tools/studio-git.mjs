import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync, lstatSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { safePath } from './files.mjs';
import { validRaster } from './site-data.mjs';
import { StudioError, strictKeys } from './studio-contract.mjs';
import { parseContentJson } from '@hien-nha/core-domain';
import { parseSiteConfig, parseHostingConfig } from '@hien-nha/core-config';
const execute = promisify(execFile);
const fixed = [
  'site.config.json',
  'hosting.config.json',
  'publication.config.json',
  'content/posts.json',
];
const eligible = (p) =>
  (fixed.includes(p) ||
    /^content\/assets\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*\.(?:png|jpe?g|webp|avif)$/.test(
      p,
    )) &&
  !p
    .split('/')
    .some((part) =>
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    );
export function githubTarget(hosting) {
  const match = /^https:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)\.github\.io$/.exec(
    hosting.origin,
  );
  if (
    !match ||
    (hosting.base !== '/' &&
      !/^\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(hosting.base))
  )
    throw new StudioError(
      422,
      'Save supported GitHub hosting coordinates first.',
    );
  return (
    match[1] +
    '/' +
    (hosting.base === '/' ? match[1] + '.github.io' : hosting.base.slice(1, -1))
  );
}
export function createStudioGit(store, options = {}) {
  const root = store.root;
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
      'SSH_AUTH_SOCK',
      'GIT_ASKPASS',
      'SSH_ASKPASS',
      'VSCODE_GIT_ASKPASS_NODE',
      'VSCODE_GIT_ASKPASS_MAIN',
      'VSCODE_GIT_IPC_HANDLE',
      'VSCODE_GIT_ASKPASS_EXTRA_ARGS',
    ]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  async function git(args, binary = false) {
    try {
      const { stdout } = await execute(
        'git',
        ['--no-optional-locks', '-c', 'core.quotePath=false', ...args],
        {
          cwd: root,
          env: { ...env, GIT_TERMINAL_PROMPT: '0' },
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 5_300_000,
          encoding: binary ? null : 'utf8',
        },
      );
      return stdout;
    } catch {
      throw new StudioError(
        409,
        'Git operation failed. Saved files/local commits remain; inspect workspace credentials or conflicts before retrying.',
      );
    }
  }
  async function context() {
    const top = (await git(['rev-parse', '--show-toplevel'])).trim();
    if (realpathSync.native(top) !== realpathSync.native(root))
      throw new StudioError(422, 'Studio must run at the repository root.');
    const branch = (await git(['symbolic-ref', '--short', 'HEAD'])).trim();
    if (branch !== 'main')
      throw new StudioError(
        422,
        'Use the main branch; no automatic branch switch is performed.',
      );
    if ((await git(['remote'])).trim() !== 'origin')
      throw new StudioError(422, 'Exactly one origin remote is required.');
    const state = store.state(),
      target = githubTarget(state.hosting);
    const urls = (await git(['remote', 'get-url', '--all', 'origin']))
      .trim()
      .split('\n');
    const pushUrls = (
      await git(['remote', 'get-url', '--push', '--all', 'origin'])
    )
      .trim()
      .split('\n');
    const matches = (url) => {
      if (options.testRemote) return url === options.testRemote;
      const parsed =
        /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([a-z0-9.-]+?)(?:\.git)?$/.exec(
          url,
        );
      return !!parsed && parsed[1].toLowerCase() + '/' + parsed[2] === target;
    };
    if (
      urls.length !== 1 ||
      pushUrls.length !== 1 ||
      !matches(urls[0]) ||
      !matches(pushUrls[0])
    )
      throw new StudioError(
        422,
        'Origin must match the saved GitHub owner/repository.',
      );
    if (
      (await git(['rev-parse', '--abbrev-ref', '@{upstream}'])).trim() !==
        'origin/main' ||
      (await git(['config', '--get', 'branch.main.remote'])).trim() !==
        'origin' ||
      (await git(['config', '--get', 'branch.main.merge'])).trim() !==
        'refs/heads/main'
    )
      throw new StudioError(422, 'Track origin/main before using Git actions.');
    const head = (await git(['rev-parse', 'HEAD'])).trim();
    const upstream = (
      await git(['rev-parse', 'refs/remotes/origin/main'])
    ).trim();
    await git(['merge-base', '--is-ancestor', upstream, head]);
    const commits = (
      await git(['rev-list', '--reverse', upstream + '..' + head])
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    if (commits.length > 20)
      throw new StudioError(
        422,
        'Review the local history manually before pushing.',
      );
    for (const sha of commits) {
      const parents = (await git(['rev-list', '--parents', '-n', '1', sha]))
        .trim()
        .split(' ');
      if (parents.length !== 2)
        throw new StudioError(
          422,
          'Review merged or unrelated local history manually.',
        );
      const names = (
        await git([
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          '-z',
          sha,
        ])
      )
        .split('\0')
        .filter(Boolean);
      if (!names.length || names.some((p) => !eligible(p)))
        throw new StudioError(
          422,
          'Local commits contain files outside the Studio allowlist.',
        );
      if (names.length > 500)
        throw new StudioError(422, 'Review large local commits manually.');
      const tree = (await git(['ls-tree', '-r', '-z', sha, '--', ...names]))
        .split('\0')
        .filter(Boolean);
      for (const entry of tree) {
        const match = /^(100644) blob ([a-f0-9]{40,64})\t(.+)$/.exec(entry);
        if (!match)
          throw new StudioError(
            422,
            'Local history contains unsupported Git file modes.',
          );
        const [, , blob, path] = match;
        const size = Number((await git(['cat-file', '-s', blob])).trim());
        if (
          !Number.isSafeInteger(size) ||
          size >
            (path.startsWith('content/assets/')
              ? 5_242_880
              : path === 'content/posts.json'
                ? 2_000_000
                : 65_536)
        )
          throw new StudioError(422, 'Local history contains oversized files.');
        const bytes = await git(['cat-file', 'blob', blob], true);
        const text = path.startsWith('content/assets/')
          ? null
          : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (path.startsWith('content/assets/')) {
          if (!validRaster(bytes, extname(path)))
            throw new StudioError(
              422,
              'Local history contains invalid raster bytes.',
            );
        } else if (path === 'content/posts.json') {
          if (parseContentJson(text).siteId !== state.site.id)
            throw new StudioError(
              422,
              'Local history contains a different content site binding.',
            );
        } else if (path === 'site.config.json') {
          if (parseSiteConfig(JSON.parse(text)).id !== state.site.id)
            throw new StudioError(422, 'Local history changes site identity.');
        } else if (path === 'hosting.config.json') {
          if (githubTarget(parseHostingConfig(JSON.parse(text))) !== target)
            throw new StudioError(
              422,
              'Review hosting target changes in local history manually.',
            );
        } else {
          const value = JSON.parse(text);
          strictKeys(value, ['schemaVersion', 'enabled']);
          if (value.schemaVersion !== 1 || typeof value.enabled !== 'boolean')
            throw new StudioError(422, 'Invalid publication history.');
        }
      }
    }
    const entries = (
      await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    )
      .split('\0')
      .filter(Boolean);
    const changes = entries.map((entry) => ({
      status: entry.slice(0, 2),
      path: entry.slice(3),
    }));
    if (
      changes.length > 500 ||
      changes.some(
        (c) =>
          ![' M', 'M ', 'MM', '??', ' A', 'A ', 'AM', ' D', 'D '].includes(
            c.status,
          ) || !eligible(c.path),
      )
    )
      throw new StudioError(
        422,
        'Unrelated or conflicted staged/workspace files must be reviewed manually.',
      );
    return { state, target, head, upstream, ahead: commits.length, changes };
  }
  function requireHead(current, expected) {
    if (current.head !== expected)
      throw new StudioError(
        409,
        'Git HEAD changed. Refresh Git status before retrying.',
      );
  }
  async function validate(current) {
    await store.validateContent(current.state.content, current.state.revision);
    const tracked = new Map(
      (await git(['ls-files', '-v', '-z']))
        .split('\0')
        .filter(Boolean)
        .map((entry) => [entry.slice(2), entry[0]]),
    );
    const changed = new Set(current.changes.map((c) => c.path));
    const required = [
      ...fixed,
      ...current.state.content.posts.flatMap((p) =>
        p.media.map((m) => 'content/assets/' + m.path),
      ),
      ...[
        current.state.site.presentation.profile.avatar,
        current.state.site.presentation.banner.image,
      ]
        .filter(Boolean)
        .map((m) => 'content/assets/' + m.path),
    ];
    if (
      required.some(
        (path) =>
          (!tracked.has(path) && !changed.has(path)) ||
          (tracked.has(path) && tracked.get(path) !== 'H'),
      )
    )
      throw new StudioError(
        422,
        'Referenced source/assets are ignored, untracked or hidden by index flags. Review Git tracking manually.',
      );
    for (const change of current.changes.filter(
      (c) => c.path.startsWith('content/assets/') && !c.status.includes('D'),
    )) {
      const file = safePath(root, change.path),
        info = lstatSync(file);
      if (
        !info.isFile() ||
        info.size > 5_242_880 ||
        !validRaster(readFileSync(file), extname(file))
      )
        throw new StudioError(
          422,
          'Git accepts supported bounded raster assets only.',
        );
    }
  }
  function view(c) {
    return {
      head: c.head,
      upstream: c.upstream,
      ahead: c.ahead,
      changes: c.changes,
      repository: c.target,
      publicationEnabled: c.state.publication.enabled,
      actionsUrl: 'https://github.com/' + c.target + '/actions',
    };
  }
  async function status() {
    return view(await context());
  }
  async function commit(body) {
    strictKeys(body, [
      'revision',
      'head',
      'message',
      'acknowledgeGitDisclosure',
    ]);
    if (
      body.acknowledgeGitDisclosure !== true ||
      typeof body.message !== 'string' ||
      !body.message.trim() ||
      body.message.length > 200 ||
      /[\r\n\x00-\x1f]/.test(body.message)
    )
      throw new StudioError(
        422,
        'Confirm Git disclosure and use a one-line commit message.',
      );
    return store.withLock(body.revision, async (_current, recheck) => {
      const current = await context();
      requireHead(current, body.head);
      if (!current.changes.length)
        throw new StudioError(422, 'No saved file changes to commit.');
      await validate(current);
      recheck();
      const latest = await context();
      requireHead(latest, body.head);
      if (JSON.stringify(latest.changes) !== JSON.stringify(current.changes))
        throw new StudioError(
          409,
          'Git changes changed; refresh before retrying.',
        );
      await git(['add', '--', ...current.changes.map((c) => c.path)]);
      await git([
        '-c',
        'core.hooksPath=' + safePath(root, '.hien-nha/no-hooks'),
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        body.message,
      ]);
      return { ...view(await context()), committed: true, pushed: false };
    });
  }
  async function push(body) {
    strictKeys(body, [
      'revision',
      'head',
      'upstream',
      'acknowledgeGitDisclosure',
    ]);
    if (body.acknowledgeGitDisclosure !== true)
      throw new StudioError(
        422,
        'Confirm public Git source/history disclosure before pushing.',
      );
    return store.withLock(body.revision, async (_current, recheck) => {
      const current = await context();
      requireHead(current, body.head);
      if (
        current.changes.length ||
        !current.ahead ||
        current.upstream !== body.upstream
      )
        throw new StudioError(
          409,
          'Commit saved changes and refresh Git status before pushing.',
        );
      await validate(current);
      const remote = (
        await git(['ls-remote', '--refs', 'origin', 'refs/heads/main'])
      )
        .trim()
        .split(/\s+/);
      if (
        remote.length !== 2 ||
        remote[0] !== current.upstream ||
        remote[1] !== 'refs/heads/main'
      )
        throw new StudioError(
          409,
          'Remote main changed. Fetch/reconcile manually; local commits are retained.',
        );
      recheck();
      requireHead(await context(), body.head);
      await git([
        '-c',
        'core.hooksPath=' + safePath(root, '.hien-nha/no-hooks'),
        '-c',
        'remote.origin.mirror=false',
        'push',
        '--no-follow-tags',
        '--recurse-submodules=no',
        'origin',
        'HEAD:refs/heads/main',
      ]);
      return {
        ...view(await context()),
        pushed: true,
        commitUrl:
          'https://github.com/' + current.target + '/commit/' + current.head,
        deployment: 'unverified',
      };
    });
  }
  return { status, commit, push };
}
