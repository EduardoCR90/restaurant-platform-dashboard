import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  configureSalitre,
  targetFromRows,
  managementApi,
  updateQuery,
} from './salitre-production.mjs';
const row = {
  restaurant_id: '00000000-0000-4000-8000-000000000101',
  integration_id: '00000000-0000-4000-8000-000000000201',
  slug: 'salitre',
  restaurant_status: 'active',
  provider: 'sanity',
  external_project_id: 'hfa8zkyw',
  external_dataset: 'staging',
  schema: 'salitre-v1',
  granted: true,
  enabled: true,
};
const target = targetFromRows([row]);
const input = {
  operation: 'apply',
  expectedRestaurant: row.restaurant_id,
  expectedIntegration: row.integration_id,
  confirmation: 'HABILITAR SALITRE PRODUCTION',
};
function fake(options = {}) {
  const calls = [],
    state = { row: { ...row }, secrets: [{ name: 'SANITY_TOKENS', digest: 'private-unused' }] };
  if (options.conflict)
    state.secrets.push({ name: 'SALITRE_PRODUCTION_WRITE_TARGET', digest: 'different' });
  const api = async (path, init = {}) => {
    calls.push({ path, ...init });
    if (path === 'database/query') {
      if (init.body.read_only) return [{ ...state.row }];
      assert.match(
        init.body.query,
        /update public\.restaurant_integrations set external_dataset='production'/,
      );
      state.row.external_dataset = 'production';
      return [];
    }
    if (init.method === 'POST') {
      assert.equal(init.body.length, 1);
      const s = init.body[0];
      assert.equal(s.name, 'SALITRE_PRODUCTION_WRITE_TARGET');
      state.secrets.push({
        name: s.name,
        digest: createHash('sha256').update(s.value).digest('hex'),
      });
      return [];
    }
    return [...state.secrets];
  };
  return { api, calls, state };
}
test('inspect solo lee y devuelve IDs seleccionados, no secretos ni configuraciones completas', async () => {
  const f = fake(),
    result = await configureSalitre({ operation: 'inspect' }, f.api);
  assert.equal(result.integrationId, row.integration_id);
  assert.equal(result.currentDataset, 'staging');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.read_only, true);
  assert.ok(!JSON.stringify(result).includes('private-unused'));
});
test('apply configura una política exacta y conserva IDs; no modifica SANITY_TOKENS ni otros registros', async () => {
  const f = fake(),
    result = await configureSalitre(input, f.api);
  assert.equal(result.status, 'configured-no-content-written');
  assert.equal(result.integrationId, row.integration_id);
  assert.equal(f.calls.filter((c) => c.path === 'secrets' && c.method === 'POST').length, 1);
  const mutations = f.calls.filter((c) => c.path === 'database/query' && !c.body.read_only);
  assert.equal(mutations.length, 1);
  assert.match(mutations[0].body.query, new RegExp(row.restaurant_id));
  assert.match(mutations[0].body.query, new RegExp(row.integration_id));
  assert.doesNotMatch(mutations[0].body.query, /insert into|delete from|alter table|create table/i);
  assert.equal(f.state.secrets[0].name, 'SANITY_TOKENS');
});
test('si la política existente difiere, se detiene sin sobrescribir ni actualizar integración', async () => {
  const f = fake({ conflict: true });
  await assert.rejects(configureSalitre(input, f.api));
  assert.ok(!f.calls.some((c) => c.method === 'POST' && c.path === 'secrets'));
  assert.ok(!f.calls.some((c) => c.body?.read_only === false));
});
test('confirmación o UUID incorrectos no permiten ninguna escritura', async () => {
  for (const change of [
    { confirmation: '' },
    { expectedIntegration: 'incorrect' },
    { expectedRestaurant: 'incorrect' },
  ]) {
    const f = fake();
    await assert.rejects(configureSalitre({ ...input, ...change }, f.api));
    assert.ok(
      !f.calls.some(
        (c) => c.body?.read_only === false || (c.path === 'secrets' && c.method === 'POST'),
      ),
    );
  }
});
test('estado incompatible o ambiguo se detiene; no hay bootstrap ni elección de otro restaurante', () => {
  for (const rows of [
    [],
    [row, row],
    [{ ...row, slug: 'other' }],
    [{ ...row, external_project_id: 'other' }],
    [{ ...row, external_dataset: 'test' }],
    [{ ...row, restaurant_status: 'suspended' }],
    [{ ...row, granted: false }],
    [{ ...row, enabled: false }],
  ])
    assert.throws(() => targetFromRows(rows));
  assert.throws(() => updateQuery({ ...target, restaurantId: "bad' SQL" }));
});
test('sin SANITY_TOKENS no cambia política o dataset; no se inventan credenciales', async () => {
  const f = fake();
  f.state.secrets = [];
  await assert.rejects(configureSalitre(input, f.api));
  assert.ok(
    !f.calls.some(
      (c) => c.body?.read_only === false || (c.path === 'secrets' && c.method === 'POST'),
    ),
  );
});
test('API fija proyecto, descarta cuerpos privados de errores y no reintenta', async () => {
  const calls = [];
  const api = managementApi('SYNTHETIC-TOKEN', async (url, init) => {
    calls.push({ url, init });
    return new Response('PRIVATE-RESPONSE-TOKEN', { status: 403 });
  });
  await assert.rejects(
    api('secrets'),
    (error) => error.message.includes('HTTP 403') && !error.message.includes('PRIVATE-RESPONSE'),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.supabase.com/v1/projects/wanrzgumoamryuybmopa/secrets');
  assert.equal(calls[0].init.redirect, 'error');
});

test('repetir configuración ya aplicada solo verifica y no reescribe secretos/dataset', async () => {
  const f = fake();
  await configureSalitre(input, f.api);
  f.calls.length = 0;
  await configureSalitre(input, f.api);
  assert.ok(
    !f.calls.some(
      (c) => c.body?.read_only === false || (c.path === 'secrets' && c.method === 'POST'),
    ),
  );
});

test('workflow operacional solo manual/main, permisos mínimos y secretos solo en el paso operativo', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile(
    new URL('../.github/workflows/configure-salitre-production.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\b(push|pull_request|schedule|workflow_call):/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /upload-artifact|contents: write|secrets\.SANITY|GITHUB_OUTPUT/);
  assert.equal((workflow.match(/secrets\.SUPABASE_ACCESS_TOKEN/g) || []).length, 1);
  assert.ok(
    workflow.indexOf('secrets.SUPABASE_ACCESS_TOKEN') >
      workflow.indexOf('name: Inspect or configure existing Salitre only'),
  );
});
