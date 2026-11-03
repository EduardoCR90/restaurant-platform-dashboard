import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { diagnoseProvisioning, diagnosticQuery, managementApi } from './diagnose-provisioning.mjs';

const requestId = '01a1a200-5d67-7c2a-8d50-cdd975f97171';

test('diagnóstico identifica secretos ausentes y confirma que el hijo Sanity no comenzó', async () => {
  const calls = [];
  const result = await diagnoseProvisioning(requestId, async (path, options = {}) => {
    calls.push({ path, options });
    if (path === 'secrets')
      return [
        { name: 'SANITY_PROVISIONER_TOKEN', value: 'private-token' },
        { name: 'SANITY_PROVISIONING_ORGANIZATION_ID', digest: 'private-digest' },
      ];
    return [
      {
        request_id: requestId,
        status: 'failed',
        stage: 'sanity',
        error_code: 'configuration',
        retryable: true,
        attempt_count: 1,
        updated_at: '2026-11-03T15:21:36Z',
        child_request_id: null,
      },
    ];
  });
  assert.equal(result.conclusion, 'missing_required_secrets');
  assert.deepEqual(result.missing, [
    'APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY',
    'APP_INTEGRATION_CREDENTIAL_KEYS',
  ]);
  assert.equal(result.sanity_child, null);
  assert.equal(calls[1].options.body.read_only, true);
  assert.doesNotMatch(JSON.stringify(result), /private-token|private-digest/);
});

test('consulta acepta solo UUID y selecciona únicamente estado seguro', () => {
  assert.match(diagnosticQuery(requestId), /where r\.request_id=/);
  assert.throws(() => diagnosticQuery("' or true--"));
});

test('cliente de gestión limita endpoints y nunca imprime respuestas', async () => {
  const calls = [];
  const api = managementApi('management-private', async (url, options) => {
    calls.push({ url, options });
    return Response.json([]);
  });
  await api('secrets');
  assert.match(calls[0].url, /wanrzgumoamryuybmopa\/secrets$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer management-private');
  await assert.rejects(() => api('unsupported'));
});

test('workflow es manual, de solo lectura y no persiste diagnósticos', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/diagnose-provisioning.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(workflow, /\npush:|schedule:|upload-artifact|supabase functions deploy/);
  assert.doesNotMatch(
    workflow,
    /operation.*retry|functions\/v1\/|database\/query.*read_only: false/,
  );
});
