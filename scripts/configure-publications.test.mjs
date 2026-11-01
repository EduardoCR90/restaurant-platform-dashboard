import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configurePublications } from './configure-publications.mjs';
const row = {
  restaurant_id: '00000000-0000-4000-8000-000000000001',
  integration_id: '00000000-0000-4000-8000-000000000002',
  slug: 'salitre',
  provider: 'sanity',
  external_project_id: 'hfa8zkyw',
  external_dataset: 'production',
  schema: 'salitre-v1',
  restaurant_status: 'active',
  granted: true,
  enabled: true,
};
function api(schema) {
  const calls = [];
  return {
    calls,
    request: async (_path, options) => {
      calls.push(options);
      if (options.body.query.includes("where r.slug='salitre'")) return [row];
      if (options.body.query.startsWith('select external_dataset'))
        return [{ external_dataset: 'production' }];
      if (options.body.query.startsWith('select to_regclass')) return [schema];
      if (options.body.query.startsWith('select count')) return [{ configured: 1 }];
      return [];
    },
  };
}
test('inspect no cambia esquema ni configuración', async () => {
  const f = api({ configurations: false, operations: false, runs: false });
  const result = await configurePublications('inspect', f.request);
  assert.equal(result.schemaReady, false);
  assert.ok(f.calls.every((c) => c.body.read_only === true));
});
test('apply usa la migración revisada y solo inserta configuración para la integración resuelta', async () => {
  const f = api({ configurations: false, operations: false, runs: false });
  await configurePublications('apply', f.request);
  const writes = f.calls.filter((c) => !c.body.read_only);
  assert.equal(writes.length, 2);
  assert.ok(writes[0].body.query.includes('create table public.publication_operations'));
  assert.ok(writes[1].body.query.includes(row.integration_id));
  assert.ok(!writes[1].body.query.includes('update public.restaurant_integrations'));
  assert.ok(!writes.some((c) => /drop table|truncate|delete from/i.test(c.body.query)));
});
test('apply detiene un esquema parcial sin sobrescribirlo', async () => {
  const f = api({ configurations: true, operations: false, runs: false });
  await assert.rejects(configurePublications('apply', f.request), /Esquema parcial/);
  assert.ok(f.calls.every((c) => c.body.read_only === true));
});
