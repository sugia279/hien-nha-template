import { spawn } from 'node:child_process';
import {
  mkdirSync,
  existsSync,
  openSync,
  closeSync,
  realpathSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { safePath } from './files.mjs';
import { buildAstro } from './studio-store.mjs';
import { verifyCore } from './verify-core.mjs';
const root = realpathSync.native(
  fileURLToPath(new URL('../', import.meta.url)),
);
verifyCore(root);
async function running() {
  let response;
  try {
    response = await fetch('http://127.0.0.1:4447/', {
      signal: AbortSignal.timeout(1500),
    });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false;
    throw Error(
      'Studio port could not be checked. Inspect the workspace before restarting.',
    );
  }
  if (
    !response.ok ||
    response.headers.get('x-hien-nha-workspace') !==
      createHash('sha256').update(root).digest('hex') ||
    !(await response.text()).includes('name="hien-nha-session"')
  )
    throw Error(
      'Port 4447 belongs to another workspace/service; no process was stopped.',
    );
  return true;
}
if (await running())
  console.log(
    'Bàn viết already runs on http://127.0.0.1:4447 — keep this port Private.',
  );
else {
  await buildAstro(root, ['build', '--config', 'studio/astro.config.mjs']);
  const internal = safePath(root, '.hien-nha');
  if (!existsSync(internal)) mkdirSync(internal);
  const log = openSync(
    safePath(root, '.hien-nha/start-' + randomUUID() + '.log'),
    'wx',
    0o600,
  );
  const child = spawn(process.execPath, [safePath(root, 'tools/studio.mjs')], {
    cwd: root,
    env: process.env,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  closeSync(log);
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  child.unref();
  let ready = false;
  try {
    for (let i = 0; i < 100 && !failed; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await running()) {
        ready = true;
        break;
      }
    }
  } finally {
    if (!ready) child.kill();
  }
  if (!ready) {
    throw Error(
      'Studio startup was not confirmed. Private logs are under .hien-nha; saved files were not changed.',
    );
  }
  console.log(
    'Bàn viết ready: http://127.0.0.1:4447 — keep port 4447 Private; check Codespaces quota and stop it when finished.',
  );
}
