import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
export const PACKAGE_IDS = Object.freeze([
  'core-domain',
  'core-config',
  'core-client',
  'core-ui',
]);
export const CONTRACTS = Object.freeze({
  siteConfig: Object.freeze({
    readable: Object.freeze([1, 2, 3]),
    writable: 3,
  }),
  theme: 1,
  hosting: 1,
  content: 1,
  identity: 1,
  contentAdapter: 1,
  authProvider: 1,
});
function check(ok) {
  if (!ok) throw Error('Invalid release compatibility metadata');
}
function object(v, keys) {
  check(v && typeof v === 'object' && !Array.isArray(v));
  check(
    Object.keys(v).length === keys.length &&
      keys.every((k) => Object.hasOwn(v, k)),
  );
}
function equal(a, b) {
  return isDeepStrictEqual(a, b);
}
function semver(v) {
  check(
    typeof v === 'string' &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v) &&
      v.length < 30,
  );
  const parts = v.split('.').map(Number);
  check(parts.every(Number.isSafeInteger));
  return parts;
}
export function validateReleaseManifest(input) {
  object(input, [
    'schemaVersion',
    'coreVersion',
    'packages',
    'contracts',
    'migrations',
    'tested',
    'policy',
  ]);
  check(input.schemaVersion === 1);
  semver(input.coreVersion);
  const names = PACKAGE_IDS.map((id) => '@hien-nha/' + id);
  object(input.packages, names);
  check(names.every((n) => input.packages[n] === input.coreVersion));
  object(input.contracts, Object.keys(CONTRACTS));
  check(equal(input.contracts, CONTRACTS));
  check(
    equal(input.migrations, [
      'site:1->2',
      'site:2->3',
      'legacy-posts->content:1',
    ]),
  );
  object(input.tested, ['node', 'npm', 'astro', 'typescript']);
  Object.values(input.tested).forEach(semver);
  object(input.policy, [
    'registryPublication',
    'automaticUpgrade',
    'backendMigrations',
  ]);
  check(Object.values(input.policy).every((v) => v === false));
  return structuredClone(input);
}
export function assertPatchCompatible(base, candidate) {
  const a = validateReleaseManifest(base),
    b = validateReleaseManifest(candidate);
  const x = semver(a.coreVersion),
    y = semver(b.coreVersion);
  check(x[0] === y[0] && x[1] === y[1] && y[2] === x[2] + 1);
  for (const k of ['contracts', 'migrations', 'tested', 'policy'])
    check(equal(a[k], b[k]));
  return b;
}
export function assertPackageGraph(manifest, packages) {
  const m = validateReleaseManifest(manifest);
  object(packages, PACKAGE_IDS);
  for (const id of PACKAGE_IDS) {
    const p = packages[id];
    check(
      p.name === '@hien-nha/' + id &&
        p.version === m.coreVersion &&
        p.private === true &&
        p.type === 'module' &&
        p.license === 'MIT' &&
        p.engines.node === m.tested.node,
    );
    const deps =
      id === 'core-domain'
        ? {}
        : id === 'core-config'
          ? { zod: '4.6.7' }
          : id === 'core-client'
            ? { '@hien-nha/core-domain': m.coreVersion }
            : {
                '@hien-nha/core-config': m.coreVersion,
                '@hien-nha/core-domain': m.coreVersion,
              };
    check(equal(p.dependencies, deps));
    for (const field of [
      'devDependencies',
      'optionalDependencies',
      'bundledDependencies',
      'bundleDependencies',
      'imports',
    ])
      check(p[field] === undefined);
    check(!p.scripts || Object.keys(p.scripts).length === 0);
    if (id === 'core-ui')
      check(equal(p.peerDependencies, { astro: '^' + m.tested.astro }));
    else check(p.peerDependencies === undefined);
  }
}
export function assertArchiveEntries(id, entries) {
  check(PACKAGE_IDS.includes(id) && Array.isArray(entries));
  const paths = entries.map((e) => e.path);
  check(new Set(paths).size === paths.length);
  const common = [
    'package.json',
    'README.md',
    'LICENSE',
    'dist/release-manifest.json',
  ];
  check(common.every((p) => paths.includes(p)));
  if (id === 'core-ui') {
    const components = [
      'Site',
      'ProfileIdentity',
      'Banner',
      'SiteNavigation',
    ].map((n) => 'src/' + n + '.astro');
    check(components.every((p) => paths.includes(p)));
    check(paths.every((p) => [...common, ...components].includes(p)));
  } else {
    check(paths.includes('dist/index.js') && paths.includes('dist/index.d.ts'));
    check(
      paths.every(
        (p) => common.includes(p) || /^dist\/[a-z-]+\.(?:js|d\.ts)$/.test(p),
      ),
    );
  }
}
export function assertPublicPackageText(text) {
  check(
    !/ONLY_ME_CANARY_|PRIVATE_VALUE_CANARY|HIDDEN_BODY_CANARY|DRAFT_CANARY_|sugia279|hiens-nha|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sb_secret_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
      text,
    ),
  );
}

// Deliberately narrow reader for our npm packs: short USTAR regular files only.
// Never extracts anything, runs hooks or accepts links/PAX/GNU extensions.
export function readPackageArchive(id, compressed, expectedIntegrity) {
  assert(
    compressed.length > 0 && compressed.length <= 1_048_576,
    'Archive size',
  );
  const integrity =
    'sha512-' + createHash('sha512').update(compressed).digest('base64');
  if (expectedIntegrity)
    assert.equal(integrity, expectedIntegrity, 'Archive integrity');
  const bytes = gunzipSync(compressed, { maxOutputLength: 8_388_608 });
  assert(bytes.length % 512 === 0, 'Truncated tar');
  const files = new Map();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  function field(header, offset, length) {
    const part = header.subarray(offset, offset + length);
    const end = part.indexOf(0);
    return decoder.decode(end < 0 ? part : part.subarray(0, end));
  }
  function octal(value) {
    const s = value.trim();
    assert(/^[0-7]+$/.test(s), 'Invalid tar number');
    const result = Number.parseInt(s, 8);
    assert(Number.isSafeInteger(result), 'Invalid tar number');
    return result;
  }
  let offset = 0;
  let terminated = false;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      assert(offset + 1024 <= bytes.length, 'Missing tar terminator');
      assert(
        bytes.subarray(offset).every((b) => b === 0),
        'Data after tar terminator',
      );
      terminated = true;
      break;
    }
    assert(files.size < 100, 'Too many archive files');
    let checksum = 0;
    for (let i = 0; i < 512; i++)
      checksum += i >= 148 && i < 156 ? 32 : header[i];
    assert.equal(checksum, octal(field(header, 148, 8)), 'Tar checksum');
    assert.equal(field(header, 257, 6), 'ustar', 'Unsupported tar format');
    assert.equal(field(header, 345, 155), '', 'Unsupported tar prefix');
    assert(
      header[156] === 0 || header[156] === 48,
      'Only regular files allowed',
    );
    assert.equal(field(header, 157, 100), '', 'Link target forbidden');
    const full = field(header, 0, 100);
    assert(/^package\/[a-zA-Z0-9/_.-]+$/.test(full), 'Unsafe archive path');
    const path = full.slice('package/'.length);
    assert(
      !path.split('/').some((p) => !p || p === '.' || p === '..'),
      'Unsafe archive path',
    );
    assert(!files.has(path), 'Duplicate archive file');
    const size = octal(field(header, 124, 12));
    assert(
      size <= 1_048_576 && offset + 512 + size <= bytes.length,
      'Invalid tar size',
    );
    const text = decoder.decode(
      bytes.subarray(offset + 512, offset + 512 + size),
    );
    assertPublicPackageText(text);
    files.set(path, text);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert(terminated, 'Missing tar terminator');
  assertArchiveEntries(
    id,
    [...files.keys()].map((path) => ({ path })),
  );
  return { files, integrity, metadata: JSON.parse(files.get('package.json')) };
}
