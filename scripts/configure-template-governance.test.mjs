import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureTemplateGovernance } from './configure-template-governance.mjs';
const ready = { releases: true, websites: true, builds: true, admin_rpc: true, report_rpc: true };
const provisioningReady = {
  jobs: true,
  credentials: true,
  claim_rpc: true,
  get_rpc: true,
  checkpoint_rpc: true,
  complete_rpc: true,
  fail_rpc: true,
};
test('inspect is read-only and refuses a partial schema', async () => {
  const calls = [];
  const result = await configureTemplateGovernance('inspect', async (path, options) => {
    calls.push({ path, options });
    return calls.length === 1 ? [ready] : [provisioningReady];
  });
  assert.equal(result.schemaReady, true);
  assert.equal(result.provisioningReady, true);
  assert.equal(calls.length, 2);
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
    if (queries.length === 2) return [provisioningReady];
    if (options.body.read_only)
      return [{ modules_protected: true, admin_protected: true, provisioning_protected: true }];
    return [];
  });
  assert.equal(result.status, 'metadata-permission-and-provisioning-policy-ready');
  assert.ok(queries[2].query.includes('Conflicting immutable release'));
  assert.ok(
    !queries.some((q) =>
      /update public.restaurant_integrations|bootstrap|delete|truncate/i.test(q.query),
    ),
  );
  assert.ok(queries.at(-1).read_only);
});

test('apply installs the reviewed provisioning migration only when the whole schema is absent', async () => {
  const queries = [];
  await configureTemplateGovernance('apply', async (_path, options) => {
    queries.push(options.body);
    if (queries.length === 1) return [ready];
    if (queries.length === 2)
      return [Object.fromEntries(Object.keys(provisioningReady).map((key) => [key, false]))];
    if (options.body.read_only)
      return [{ modules_protected: true, admin_protected: true, provisioning_protected: true }];
    return [];
  });
  assert.ok(queries.some((query) => query.query.includes('sanity_provisioning_jobs')));
  assert.ok(queries.some((query) => query.query.includes('integration_credentials')));
  assert.ok(!queries.some((query) => /delete|truncate|drop table/i.test(query.query)));
});
