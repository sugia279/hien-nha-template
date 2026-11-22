import { appendFileSync } from 'node:fs';
import { readJson } from './files.mjs';
import { readSite } from './site-data.mjs';
export function pagesPreflight(hosting, publication, repository) {
  if (
    !publication ||
    Object.keys(publication).sort().join(',') !== 'enabled,schemaVersion' ||
    publication.schemaVersion !== 1 ||
    typeof publication.enabled !== 'boolean'
  )
    throw Error('Invalid publication configuration');
  if (!publication.enabled) return { enabled: false };
  if (
    typeof repository !== 'string' ||
    !/^([a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*)\/([a-z0-9]+(?:[.-][a-z0-9]+)*)$/.test(
      repository,
    )
  )
    throw Error(
      'Use a supported GitHub account and exact lowercase repository',
    );
  const [account, repo] = repository.split('/'),
    owner = account.toLowerCase(),
    origin = 'https://' + owner + '.github.io',
    base = repo === owner + '.github.io' ? '/' : '/' + repo + '/';
  if (hosting.origin !== origin || hosting.base !== base)
    throw Error(
      'Hosting must match the approved GitHub Pages repository; custom domains need separate setup',
    );
  return { enabled: true, origin, base };
}
if (
  process.argv[1]?.replaceAll('\\', '/').endsWith('/tools/pages-preflight.mjs')
) {
  const { hosting } = readSite(process.cwd());
  const result = pagesPreflight(
    hosting,
    readJson(process.cwd(), 'publication.config.json', 4096),
    process.env.GITHUB_REPOSITORY,
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      'enabled=' + result.enabled + '\n',
    );
  console.log(
    result.enabled
      ? 'Pages preflight passed for configured repository.'
      : 'Publication is disabled. Configure your own repository and opt in before deploying.',
  );
}
