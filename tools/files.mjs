import { resolve, relative, isAbsolute, join } from 'node:path';
import {
  lstatSync,
  existsSync,
  readFileSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';

export function safePath(root, logical, createParents = false) {
  if (
    typeof logical !== 'string' ||
    logical.includes('\\') ||
    logical.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw Error('Unsafe site path');
  const base = realpathSync.native(root),
    dest = resolve(base, logical),
    rel = relative(base, dest);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw Error('Site path escapes root');
  let current = base;
  const parts = logical.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    if (existsSync(current)) {
      const info = lstatSync(current);
      if (
        info.isSymbolicLink() ||
        (i < parts.length - 1 && !info.isDirectory())
      )
        throw Error('Site links and non-directory parents forbidden');
    } else if (createParents && i < parts.length - 1) mkdirSync(current);
  }
  return dest;
}
export function readJson(root, path, max = 65_536) {
  const file = safePath(root, path),
    info = lstatSync(file);
  if (!info.isFile() || info.size > max)
    throw Error('Invalid or oversized site document');
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file)),
    );
  } catch {
    throw Error('Invalid JSON site document');
  }
}
export function resetGenerated(root) {
  const base = realpathSync.native(root),
    target = safePath(base, '.generated');
  if (relative(base, target) !== '.generated')
    throw Error('Unsafe generated target');
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(target);
  return target;
}
