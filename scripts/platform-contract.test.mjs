import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('portable platform contract matches the immutable template release', async () => {
  const root = new URL('../', import.meta.url);
  const lock = JSON.parse(await readFile(new URL('platform-contract.lock.json', root), 'utf8'));
  assert.equal(lock.repository, 'EduardoCR90/restaurant-astro-template');
  assert.equal(lock.version, '0.3.0');
  assert.match(lock.commit, /^[a-f0-9]{40}$/);
  assert.equal(lock.source, 'src/types/platform.ts');
  assert.equal(lock.file, 'shared/platform-contract.ts');
  const source = await readFile(new URL(lock.file, root));
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    lock.sha256,
    'Do not edit this distribution independently: update the canonical template and its release manifest together.',
  );
});
