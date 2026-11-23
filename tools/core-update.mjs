import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { safePath, readJson } from './files.mjs';
import {
  PACKAGE_IDS,
  validateReleaseManifest,
  assertPatchCompatible,
  assertPackageGraph,
  readPackageArchive,
} from './core-release.mjs';

export const RELEASE_REPOSITORY = 'sugia279/hien-nha-template';
const api = 'https://api.github.com/repos/' + RELEASE_REPOSITORY;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (bytes) =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const same = (a, b) =>
  assert.deepEqual(a, b, 'Unsupported release/update metadata');
function keys(value, expected) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  same(Object.keys(value).sort(), [...expected].sort());
}
export function nextPatch(version) {
  assert(/^0\.1\.(0|[1-9]\d{0,5})$/.test(version), 'Unsupported Core version');
  return '0.1.' + (Number(version.split('.')[2]) + 1);
}
const tagFor = (version) => 'core-v' + version;
const assetURL = (version, name) =>
  'https://github.com/' +
  RELEASE_REPOSITORY +
  '/releases/download/' +
  tagFor(version) +
  '/' +
  name;

// No credentials are accepted or forwarded, including to signed asset redirects.
export async function downloadPublic(
  url,
  maximum,
  { fetcher = fetch, missing = false } = {},
) {
  let current = new URL(url);
  const isAPI = current.hostname === 'api.github.com';
  for (let redirects = 0; redirects <= 3; redirects++) {
    assert(
      current.protocol === 'https:' &&
        !current.username &&
        !current.password &&
        !current.port,
      'Unsafe download URL',
    );
    assert(
      (isAPI && current.hostname === 'api.github.com' && redirects === 0) ||
        (!isAPI &&
          [
            'github.com',
            'release-assets.githubusercontent.com',
            'objects.githubusercontent.com',
          ].includes(current.hostname)),
      'Unsafe release redirect',
    );
    const response = await fetcher(current.href, {
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: isAPI
          ? 'application/vnd.github+json'
          : 'application/octet-stream',
        'X-GitHub-Api-Version': '2026-03-10',
      },
    });
    if (response.status === 404 && missing && redirects === 0) return undefined;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      assert(
        !isAPI && redirects < 3 && response.headers.get('location'),
        'Unexpected API/asset redirect',
      );
      await response.body?.cancel();
      current = new URL(response.headers.get('location'), current);
      continue;
    }
    assert(
      response.status === 200 && response.body,
      'Release download unavailable',
    );
    const length = response.headers.get('content-length');
    assert(
      !length || (/^\d+$/.test(length) && Number(length) <= maximum),
      'Release response too large',
    );
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert(size <= maximum, 'Release response too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw Error('Too many release redirects');
}

export function validateIndex(index) {
  keys(index, [
    'schemaVersion',
    'repository',
    'sourceRepository',
    'sourceCommit',
    'sourceTree',
    'distributionCommit',
    'distributionTree',
    'manifest',
    'packages',
  ]);
  assert(
    index.schemaVersion === 1 &&
      index.repository === RELEASE_REPOSITORY &&
      index.sourceRepository === 'sugia279/hien-nha',
  );
  assert(
    /^[a-f0-9]{40}$/.test(index.sourceCommit) &&
      /^[a-f0-9]{40}$/.test(index.sourceTree) &&
      /^[a-f0-9]{40}$/.test(index.distributionCommit) &&
      /^[a-f0-9]{40}$/.test(index.distributionTree),
  );
  const manifest = validateReleaseManifest(index.manifest);
  assert(Array.isArray(index.packages) && index.packages.length === 4);
  same(
    index.packages.map((p) => p.id),
    PACKAGE_IDS,
  );
  for (const p of index.packages) {
    keys(p, ['id', 'file', 'bytes', 'integrity', 'sha256']);
    assert(p.file === 'hien-nha-' + p.id + '-' + manifest.coreVersion + '.tgz');
    assert(
      Number.isSafeInteger(p.bytes) && p.bytes > 0 && p.bytes <= 1_048_576,
    );
    assert(
      /^sha512-[A-Za-z0-9+/]{86}==$/.test(p.integrity) &&
        /^[a-f0-9]{64}$/.test(p.sha256),
    );
  }
  return manifest;
}

export function verifyBundle(index, archives) {
  const manifest = validateIndex(index),
    metadata = {};
  same([...archives.keys()].sort(), [...PACKAGE_IDS].sort());
  for (const p of index.packages) {
    const bytes = archives.get(p.id);
    assert(
      bytes.length === p.bytes && sha(bytes) === p.sha256,
      'Core asset bytes/hash changed',
    );
    const archive = readPackageArchive(p.id, bytes, p.integrity);
    same(
      json(Buffer.from(archive.files.get('dist/release-manifest.json'))),
      manifest,
    );
    metadata[p.id] = archive.metadata;
  }
  assertPackageGraph(manifest, metadata);
  return { manifest, metadata };
}

export async function fetchRelease(version, transport = downloadPublic) {
  const tag = tagFor(version);
  const bytes = await transport(api + '/releases/tags/' + tag, 131_072, {
    missing: true,
  });
  if (!bytes) return undefined;
  const release = json(bytes);
  assert(
    release.tag_name === tag &&
      release.draft === false &&
      release.prerelease === false &&
      typeof release.published_at === 'string',
    'Not a published stable Core release',
  );
  assert(
    release.html_url ===
      'https://github.com/' + RELEASE_REPOSITORY + '/releases/tag/' + tag,
  );
  const names = [
    'core-release.json',
    ...PACKAGE_IDS.map((id) => 'hien-nha-' + id + '-' + version + '.tgz'),
  ];
  assert(Array.isArray(release.assets));
  same(release.assets.map((a) => a.name).sort(), [...names].sort());
  for (const a of release.assets) {
    assert(
      a.state === 'uploaded' &&
        a.browser_download_url === assetURL(version, a.name),
    );
    assert(
      Number.isSafeInteger(a.size) &&
        a.size > 0 &&
        a.size <= (a.name === 'core-release.json' ? 65_536 : 1_048_576),
    );
    assert(
      /^sha256:[a-f0-9]{64}$/.test(a.digest),
      'Provider asset digest required',
    );
  }
  const assets = new Map();
  for (const name of names) {
    const asset = release.assets.find((a) => a.name === name);
    const body = await transport(assetURL(version, name), asset.size);
    assert(
      body.length === asset.size && 'sha256:' + sha(body) === asset.digest,
      'Provider asset digest/size mismatch',
    );
    assets.set(name, body);
  }
  const index = json(assets.get('core-release.json'));
  assert(validateIndex(index).coreVersion === version);
  let ref = json(await transport(api + '/git/ref/tags/' + tag, 16_384)).object;
  for (let depth = 0; ref?.type === 'tag' && depth < 3; depth++) {
    assert(/^[a-f0-9]{40}$/.test(ref.sha));
    ref = json(await transport(api + '/git/tags/' + ref.sha, 16_384)).object;
  }
  assert(
    ref?.type === 'commit' && ref.sha === index.distributionCommit,
    'Release tag/distribution mismatch',
  );
  const tree = json(
    await transport(api + '/git/trees/' + index.distributionCommit, 65_536),
  );
  assert(tree.truncated === false && Array.isArray(tree.tree));
  assert(
    tree.tree.find((p) => p.path === 'vendor' && p.type === 'tree')?.sha ===
      index.distributionTree,
    'Release distribution tree mismatch',
  );
  const archives = new Map(
    index.packages.map((p) => [p.id, assets.get(p.file)]),
  );
  verifyBundle(index, archives);
  const vendor = json(
    await transport(api + '/git/trees/' + index.distributionTree, 65_536),
  );
  assert(vendor.truncated === false && Array.isArray(vendor.tree));
  same(
    vendor.tree.map((p) => p.path).sort(),
    index.packages.map((p) => p.file).sort(),
  );
  for (const p of index.packages) {
    const b = archives.get(p.id),
      entry = vendor.tree.find((e) => e.path === p.file);
    const blob = createHash('sha1')
      .update(Buffer.from('blob ' + b.length + '\0'))
      .update(b)
      .digest('hex');
    assert(
      entry.type === 'blob' && entry.mode === '100644' && entry.sha === blob,
      'Release bytes differ from public Git vendor',
    );
  }
  return { index, archives };
}

export function currentCore(root) {
  const pin = readJson(root, 'core.lock.json', 16_384),
    pkg = readJson(root, 'package.json'),
    lock = readJson(root, 'package-lock.json', 2_000_000);
  assert(
    pin.schemaVersion === 1 &&
      Array.isArray(pin.packages) &&
      pin.packages.length === 4,
  );
  nextPatch(pin.version);
  same(
    pin.packages.map((p) => p.id),
    PACKAGE_IDS,
  );
  same(lock.packages[''].dependencies, pkg.dependencies);
  let manifest;
  const metadata = {};
  for (const p of pin.packages) {
    const name = '@hien-nha/' + p.id,
      file = 'hien-nha-' + p.id + '-' + pin.version + '.tgz';
    assert(p.file === file);
    const path = safePath(root, 'vendor/' + file),
      info = lstatSync(path);
    assert(info.isFile() && info.size <= 1_048_576, 'Existing archive size');
    const bytes = readFileSync(path);
    const archive = readPackageArchive(p.id, bytes, p.integrity);
    const m = validateReleaseManifest(
      json(Buffer.from(archive.files.get('dist/release-manifest.json'))),
    );
    if (manifest) same(m, manifest);
    else manifest = m;
    assert(
      m.coreVersion === pin.version &&
        pkg.dependencies[name] === 'file:vendor/' + file,
    );
    const installedPin = lock.packages['node_modules/' + name];
    assert(
      installedPin &&
        !installedPin.link &&
        installedPin.version === pin.version &&
        installedPin.integrity === p.integrity &&
        installedPin.resolved === 'file:vendor/' + file,
      'Existing Core lock drift',
    );
    // npm omits empty dependency maps in a real generated lockfile.
    // Absence and {} are equivalent; null or any changed dependency is not.
    same(
      installedPin.dependencies === undefined ? {} : installedPin.dependencies,
      archive.metadata.dependencies === undefined
        ? {}
        : archive.metadata.dependencies,
    );
    same(
      installedPin.peerDependencies === undefined
        ? {}
        : installedPin.peerDependencies,
      archive.metadata.peerDependencies === undefined
        ? {}
        : archive.metadata.peerDependencies,
    );
    metadata[p.id] = archive.metadata;
  }
  assertPackageGraph(manifest, metadata);
  return { pin, pkg, lock, manifest };
}

export function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 4_000_000,
    }).trim();
  } catch {
    throw Error(
      'Core update Git operation failed; inspect the disposable workspace.',
    );
  }
}
function ignored(root, path) {
  const result = spawnSync(
    'git',
    ['check-ignore', '--no-index', '--quiet', '--', path],
    { cwd: root, stdio: 'ignore', timeout: 30_000 },
  );
  assert([0, 1].includes(result.status), 'Cannot inspect Git ignore rules');
  return result.status === 0;
}
export function guardGit(root, repository, { testRemote } = {}) {
  assert(
    typeof repository === 'string' &&
      /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(
        repository,
      ),
    'Unsupported destination repository',
  );
  assert(
    realpathSync.native(git(root, ['rev-parse', '--show-toplevel'])) ===
      realpathSync.native(root),
    'Wrong Git root',
  );
  assert(git(root, ['branch', '--show-current']) === 'main');
  assert(
    git(root, ['status', '--porcelain', '--untracked-files=all']) === '',
    'Dirty/staged update workspace',
  );
  same(git(root, ['remote']).split('\n'), ['origin']);
  const remote = git(root, ['remote', 'get-url', '--all', 'origin']);
  const origins = testRemote
    ? [testRemote]
    : [
        'https://github.com/' + repository,
        'https://github.com/' + repository + '.git',
      ];
  assert(origins.includes(remote), 'Wrong destination origin');
  assert(
    origins.includes(
      git(root, ['remote', 'get-url', '--push', '--all', 'origin']),
    ),
    'Wrong push origin',
  );
  assert(
    git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) ===
      'origin/main',
  );
  const base = git(root, ['rev-parse', 'HEAD']);
  assert(
    git(root, ['rev-parse', 'origin/main']) === base &&
      git(root, ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0] ===
        base,
    'Remote main changed',
  );
  return base;
}

export async function prepareUpdate(
  root,
  repository,
  { transport, testRemote } = {},
) {
  const base = guardGit(root, repository, { testRemote }),
    current = currentCore(root);
  const release = await fetchRelease(nextPatch(current.pin.version), transport);
  if (!release) return undefined;
  const { index, archives } = release;
  const manifest = assertPatchCompatible(current.manifest, index.manifest);
  const { metadata } = verifyBundle(index, archives);
  const before = new Map();
  for (const path of git(root, ['ls-files', '-z']).split('\0').filter(Boolean))
    before.set(path, sha(readFileSync(safePath(root, path))));
  const paths = [
    'package.json',
    'package-lock.json',
    'core.lock.json',
    ...current.pin.packages.map((p) => 'vendor/' + p.file),
    ...index.packages.map((p) => 'vendor/' + p.file),
  ];
  assert(new Set(paths).size === 11);
  for (const p of index.packages) {
    assert(
      !existsSync(safePath(root, 'vendor/' + p.file)),
      'Candidate archive already exists',
    );
    assert(!ignored(root, 'vendor/' + p.file), 'Ignored candidate file');
  }
  const pkg = structuredClone(current.pkg),
    lock = structuredClone(current.lock),
    files = new Map();
  for (const p of index.packages) {
    const name = '@hien-nha/' + p.id;
    pkg.dependencies[name] = 'file:vendor/' + p.file;
    lock.packages[''].dependencies[name] = 'file:vendor/' + p.file;
    const entry = lock.packages['node_modules/' + name];
    entry.version = manifest.coreVersion;
    entry.resolved = 'file:vendor/' + p.file;
    entry.integrity = p.integrity;
    entry.dependencies = metadata[p.id].dependencies;
    files.set('vendor/' + p.file, archives.get(p.id));
  }
  files.set('package.json', encode(pkg));
  files.set('package-lock.json', encode(lock));
  files.set(
    'core.lock.json',
    encode({
      ...current.pin,
      version: manifest.coreVersion,
      sourceCommit: index.sourceCommit,
      sourceTree: index.sourceTree,
      distribution:
        'GitHub Releases: ' +
        RELEASE_REPOSITORY +
        '/' +
        tagFor(manifest.coreVersion),
      packages: index.packages.map(({ id, file, integrity }) => ({
        id,
        file,
        integrity,
      })),
    }),
  );
  const deleted = current.pin.packages.map((p) => 'vendor/' + p.file);
  const fingerprint = sha(
    encode({
      base,
      index,
      before: [...before],
      files: [...files].map(([p, b]) => [p, sha(b)]),
      deleted,
    }),
  );
  assert(
    guardGit(root, repository, { testRemote }) === base,
    'Stale update source',
  );
  return {
    base,
    repository,
    version: manifest.coreVersion,
    from: current.pin.version,
    fingerprint,
    files,
    deleted,
    before,
    paths,
  };
}

export function applyUpdate(root, plan, options = {}) {
  assert(
    guardGit(root, plan.repository, options) === plan.base,
    'Stale update base',
  );
  for (const [path, hash] of plan.before)
    assert(
      sha(readFileSync(safePath(root, path))) === hash,
      'Stale source bytes',
    );
  for (const [path] of plan.files) safePath(root, path);
  for (const path of plan.deleted) safePath(root, path);
  assert(
    ignored(root, '.hien-nha/core-update.json'),
    'Private update state must be ignored',
  );
  const internal = safePath(root, '.hien-nha');
  if (!existsSync(internal)) mkdirSync(internal);
  const record = {
    base: plan.base,
    fingerprint: plan.fingerprint,
    repository: plan.repository,
    paths: plan.paths,
    before: [...plan.before],
    files: [...plan.files].map(([p, b]) => [p, sha(b)]),
    deleted: plan.deleted,
  };
  writeFileSync(safePath(root, '.hien-nha/core-update.json'), encode(record), {
    flag: 'wx',
    mode: 0o600,
  });
  for (const [path, bytes] of plan.files)
    writeFileSync(safePath(root, path), bytes);
  for (const path of plan.deleted) unlinkSync(safePath(root, path));
  attestUpdate(root, plan.fingerprint);
}

export function attestUpdate(root, fingerprint) {
  const record = readJson(root, '.hien-nha/core-update.json', 2_000_000);
  assert(
    record.fingerprint === fingerprint &&
      git(root, ['rev-parse', 'HEAD']) === record.base,
  );
  const allowed = new Set(record.paths);
  for (const [path, hash] of record.before)
    if (!allowed.has(path))
      assert(
        sha(readFileSync(safePath(root, path))) === hash,
        'Owner/source bytes changed',
      );
  for (const [path, hash] of record.files)
    assert(
      sha(readFileSync(safePath(root, path))) === hash,
      'Candidate bytes changed',
    );
  for (const path of record.deleted) assert(!existsSync(safePath(root, path)));
  const dirty = git(root, ['diff', '--name-only', 'HEAD'])
    .split('\n')
    .filter(Boolean);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean);
  assert(
    [...dirty, ...untracked].every((p) => allowed.has(p)),
    'Unrelated update files',
  );
  return record;
}

async function main() {
  const root = process.cwd(),
    command = process.argv[2];
  assert(['--prepare', '--attest'].includes(command));
  assert(
    process.env.GITHUB_ACTIONS === 'true' &&
      process.env.GITHUB_REF === 'refs/heads/main',
    'Only a disposable main workflow workspace may apply updates',
  );
  assert(
    git(root, ['rev-parse', 'HEAD']) === process.env.HIEN_NHA_BASE_SHA,
    'Workflow base changed',
  );
  if (command === '--attest') {
    attestUpdate(root, process.env.EXPECTED_FINGERPRINT);
    console.log('Core candidate/source byte attestation passed.');
    return;
  }
  const config = readJson(root, 'core-updates.config.json');
  keys(config, ['schemaVersion', 'enabled']);
  assert(config.schemaVersion === 1 && typeof config.enabled === 'boolean');
  if (!config.enabled && process.env.HIEN_NHA_UPDATE_ONCE !== 'true') {
    console.log('Core release checks are disabled; no update was attempted.');
    return;
  }
  const plan = await prepareUpdate(root, process.env.GITHUB_REPOSITORY);
  if (!plan) {
    console.log('No next compatible Core release is published.');
    return;
  }
  if (process.env.EXPECTED_FINGERPRINT)
    assert(
      plan.fingerprint === process.env.EXPECTED_FINGERPRINT,
      'Release/base changed between jobs',
    );
  applyUpdate(root, plan);
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      'changed=true\nfingerprint=' + plan.fingerprint + '\n',
    );
  }
  console.log(
    'Prepared Core ' +
      plan.from +
      ' → ' +
      plan.version +
      ' for review; owner source is unchanged.',
  );
}
if (
  process.argv[1] &&
  realpathSync.native(process.argv[1]) ===
    realpathSync.native(fileURLToPath(import.meta.url))
) {
  try {
    await main();
  } catch {
    console.error(
      'Core update rejected. Saved owner files must not be reset; inspect this disposable workflow workspace and the release pins.',
    );
    process.exitCode = 1;
  }
}
