import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureTemplateGovernance } from './configure-template-governance.mjs';
const ready = { releases: true, websites: true, builds: true, admin_rpc: true, report_rpc: true };
test('inspect is read-only and refuses a partial schema', async () => {
  const calls = [];
  const result = await configureTemplateGovernance('inspect', async (path, options) => {
    calls.push({ path, options });
    return [ready];
  });
  assert.equal(result.schemaReady, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.body.read_only, true);
  await assert.rejects(
    configureTemplateGovernance('apply', async () => [{ ...ready, builds: false }]),
    /Partial/,
  );
});
test('apply checks immutable release identity and module/RPC privilege protection', async () => {
  const queries = [];
  const result = await configureTemplateGovernance('apply', async (_path, options) => {
    queries.push(options.body);
    if (queries.length === 1) return [ready];
    if (options.body.read_only) return [{ modules_protected: true, admin_protected: true }];
    return [];
  });
  assert.equal(result.status, 'metadata-and-permission-policy-ready');
  assert.ok(queries[1].query.includes('Conflicting immutable release'));
  assert.ok(
    !queries.some((q) =>
      /update public.restaurant_integrations|bootstrap|delete|truncate/i.test(q.query),
    ),
  );
  assert.ok(queries.at(-1).read_only);
});
