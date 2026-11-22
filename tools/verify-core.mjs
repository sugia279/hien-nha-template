import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { safePath, readJson } from './files.mjs';
import assert from 'node:assert/strict';
function checkCore(root) {
  const pin = readJson(root, 'core.lock.json', 16_384),
    pkg = readJson(root, 'package.json'),
    lock = readJson(root, 'package-lock.json', 2_000_000);
  assert(
    pin.schemaVersion === 1 &&
      /^0\.1\.\d+$/.test(pin.version) &&
      Array.isArray(pin.packages) &&
      pin.packages.length === 4,
    'Unsupported Core pins',
  );
  const ids = ['core-domain', 'core-config', 'core-client', 'core-ui'];
  assert.deepEqual(
    pin.packages.map((p) => p.id).sort(),
    [...ids].sort(),
    'Core package set changed',
  );
  let reference;
  for (const entry of pin.packages) {
    const file = 'hien-nha-' + entry.id + '-' + pin.version + '.tgz',
      name = '@hien-nha/' + entry.id;
    assert.equal(entry.file, file);
    const archive = safePath(root, 'vendor/' + file),
      info = lstatSync(archive);
    assert(info.isFile() && info.size <= 1_048_576, 'Invalid Core archive');
    assert.equal(
      'sha512-' +
        createHash('sha512').update(readFileSync(archive)).digest('base64'),
      entry.integrity,
      'Core archive integrity changed',
    );
    assert.equal(pkg.dependencies[name], 'file:vendor/' + file);
    const locked = lock.packages['node_modules/' + name];
    assert(
      locked &&
        !locked.link &&
        locked.version === pin.version &&
        locked.integrity === entry.integrity &&
        locked.resolved === 'file:vendor/' + file,
      'Core install lock changed',
    );
    const installed = readJson(root, 'node_modules/' + name + '/package.json');
    assert(
      installed.name === name &&
        installed.version === pin.version &&
        installed.private === true,
      'Installed Core differs from pins',
    );
    const manifest = readJson(
      root,
      'node_modules/' + name + '/dist/release-manifest.json',
    );
    assert(
      manifest.schemaVersion === 1 && manifest.coreVersion === pin.version,
      'Core manifest version changed',
    );
    assert.deepEqual(
      manifest.contracts,
      {
        siteConfig: { readable: [1, 2, 3], writable: 3 },
        theme: 1,
        hosting: 1,
        content: 1,
        identity: 1,
        contentAdapter: 1,
        authProvider: 1,
      },
      'Unsupported Core contracts',
    );
    assert.deepEqual(
      manifest.policy,
      {
        registryPublication: false,
        automaticUpgrade: false,
        backendMigrations: false,
      },
      'Unsupported release policy',
    );
    if (reference)
      assert.deepEqual(manifest, reference, 'Core manifests disagree');
    else reference = manifest;
  }
  assert.equal(
    process.versions.node,
    reference.tested.node,
    'Unsupported Node profile',
  );
  for (const [name, version] of Object.entries({
    astro: reference.tested.astro,
    typescript: reference.tested.typescript,
  }))
    assert.equal(
      readJson(root, 'node_modules/' + name + '/package.json').version,
      version,
      'Review an updated toolchain profile',
    );
  return {
    version: pin.version,
    contracts: reference.contracts,
    automaticUpgrade: false,
  };
}
export function verifyCore(root) {
  try {
    return checkCore(root);
  } catch (error) {
    throw Error(
      'Core verification failed: ' +
        (error.code === 'ERR_ASSERTION'
          ? error.message.split('\n')[0]
          : 'Invalid files or unsupported pins. Check vendor/install/lock/contracts before retrying.'),
    );
  }
}
if (
  process.argv[1] &&
  realpathSync.native(process.argv[1]) ===
    realpathSync.native(fileURLToPath(import.meta.url))
) {
  const result = verifyCore(process.cwd());
  console.log(
    'Core ' +
      result.version +
      ' vendor/install/contracts verified; no automatic release channel or upgrade.',
  );
}
