import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  prepareUpdate,
  applyUpdate,
  attestUpdate,
  guardGit,
  git,
  RELEASE_REPOSITORY,
} from './core-update.mjs';

export async function createUpdatePR(
  root,
  repository,
  fingerprint,
  { transport, testRemote, request } = {},
) {
  assert(
    /^[a-f0-9]{64}$/.test(fingerprint),
    'Expected tested fingerprint required',
  );
  const plan = await prepareUpdate(root, repository, { transport, testRemote });
  assert(
    plan && plan.fingerprint === fingerprint,
    'Candidate/base changed after verification',
  );
  const branch = 'codex/core-' + plan.version + '-' + fingerprint.slice(0, 12);
  if (git(root, ['ls-remote', 'origin', 'refs/heads/' + branch]))
    return { existing: true, branch };
  applyUpdate(root, plan, { testRemote });
  attestUpdate(root, fingerprint);
  git(root, ['add', '--', ...plan.paths]);
  const changed = git(root, ['diff', '--cached', '--no-renames', '--name-only'])
    .split('\n')
    .filter(Boolean);
  assert(
    changed.length === 11 && changed.every((p) => plan.paths.includes(p)),
    'Unexpected staged update',
  );
  assert(
    git(root, ['rev-parse', '--show-object-format']) === 'sha1',
    'Unsupported Git object format',
  );
  const expectedTree = git(root, ['write-tree']);
  const call =
    request ||
    ((path, payload) => {
      const output = execFileSync(
        'gh',
        [
          'api',
          '--method',
          'POST',
          'repos/' + repository + '/' + path,
          '--input',
          '-',
        ],
        {
          cwd: root,
          input: JSON.stringify(payload),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30_000,
          maxBuffer: 131_072,
        },
      );
      return JSON.parse(output);
    });
  const entries = [];
  for (const [path, bytes] of plan.files) {
    const expected = createHash('sha1')
      .update(Buffer.from('blob ' + bytes.length + '\0'))
      .update(bytes)
      .digest('hex');
    const blob = await call('git/blobs', {
      content: bytes.toString('base64'),
      encoding: 'base64',
    });
    assert(blob.sha === expected, 'Unexpected uploaded Git blob');
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const path of plan.deleted)
    entries.push({ path, mode: '100644', type: 'blob', sha: null });
  const tree = await call('git/trees', {
    base_tree: git(root, ['rev-parse', 'HEAD^{tree}']),
    tree: entries,
  });
  assert(
    tree.sha === expectedTree,
    'Candidate tree differs from locally attested bytes',
  );
  const commit = await call('git/commits', {
    message: 'Update Core ' + plan.from + ' to ' + plan.version,
    tree: tree.sha,
    parents: [plan.base],
  });
  assert(
    /^[a-f0-9]{40}$/.test(commit.sha) &&
      commit.tree?.sha === expectedTree &&
      commit.parents?.length === 1 &&
      commit.parents[0].sha === plan.base,
    'Unexpected update commit',
  );
  assert(
    git(root, ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0] ===
      plan.base,
    'Remote main changed before branch creation',
  );
  // POST create-ref is atomic and fails if the branch appeared concurrently.
  // No update-ref/PATCH, main push or force-push endpoint is used.
  const ref = await call('git/refs', {
    ref: 'refs/heads/' + branch,
    sha: commit.sha,
  });
  assert(ref.ref === 'refs/heads/' + branch && ref.object?.sha === commit.sha);
  const head = commit.sha;
  const payload = {
    title: 'Update Core to ' + plan.version,
    head: branch,
    base: 'main',
    body:
      'Receives the published Core release from https://github.com/' +
      RELEASE_REPOSITORY +
      '/releases/tag/core-v' +
      plan.version +
      '.\n\nCandidate fingerprint: `' +
      fingerprint +
      '`. The read-only verification job passed npm ci, verify and audit before this branch was prepared independently. Owner config/content/media/publication bytes are preserved; only four vendor archives and package/Core pins change.\n\nReview this exact head and all checks before merging. GitHub may require Approve workflows for a PR created using GITHUB_TOKEN. This PR does not approve itself, auto-merge, deploy or migrate a site.',
  };
  const parsed = await call('pulls', payload);
  assert(
    parsed.head?.sha === head &&
      parsed.base?.ref === 'main' &&
      parsed.html_url ===
        'https://github.com/' + repository + '/pull/' + parsed.number &&
      Number.isSafeInteger(parsed.number),
    'Unexpected PR result',
  );
  return { branch, head, number: parsed.number, url: parsed.html_url };
}
async function main() {
  const root = process.cwd();
  assert(
    process.env.GITHUB_ACTIONS === 'true' &&
      process.env.GITHUB_REF === 'refs/heads/main',
  );
  assert(git(root, ['rev-parse', 'HEAD']) === process.env.HIEN_NHA_BASE_SHA);
  guardGit(root, process.env.GITHUB_REPOSITORY);
  const result = await createUpdatePR(
    root,
    process.env.GITHUB_REPOSITORY,
    process.env.EXPECTED_FINGERPRINT,
  );
  console.log(
    result.existing
      ? 'The deterministic Core update branch already exists; it was not changed.'
      : 'Created reviewable Core PR: ' + result.url,
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
      'Core PR creation failed. No main push/force update was attempted; inspect the disposable branch and workflow permissions before retrying.',
    );
    process.exitCode = 1;
  }
}
