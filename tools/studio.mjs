import { realpathSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { safePath } from './files.mjs';
import { createStudioServer } from './studio-server.mjs';
const root = realpathSync.native(
  fileURLToPath(new URL('../', import.meta.url)),
);
if (!existsSync(safePath(root, '.hien-nha/studio/index.html')))
  throw new Error('Run npm run studio:build first.');
const { server } = createStudioServer(root);
server.listen(4447, '127.0.0.1', () =>
  console.log('Bàn viết: http://127.0.0.1:4447 — keep this port private.'),
);
