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
const astroReady = {
  jobs: true,
  claim_rpc: true,
  get_rpc: true,
  checkpoint_rpc: true,
  await_rpc: true,
  confirm_rpc: true,
  complete_rpc: true,
  fail_rpc: true,
};
const completeReady = {
  jobs: true,
  domains: true,
  claim_rpc: true,
  list_rpc: true,
  checkpoint_rpc: true,
  wait_rpc: true,
  invite_rpc: true,
  complete_rpc: true,
  fail_rpc: true,
};
const protections = {
  modules_protected: true,
  admin_protected: true,
  provisioning_protected: true,
  astro_provisioning_protected: true,
  complete_provisioning_protected: true,
};
test('inspect is read-only and refuses a partial schema', async () => {
  const calls = [];
  const result = await configureTemplateGovernance('inspect', async (path, options) => {
    calls.push({ path, options });
    return calls.length === 1
      ? [ready]
      : calls.length === 2
        ? [provisioningReady]
        : calls.length === 3
          ? [astroReady]
          : [completeReady];
  });
  assert.equal(result.schemaReady, true);
  assert.equal(result.provisioningReady, true);
  assert.equal(result.astroProvisioningReady, true);
  assert.equal(result.completeProvisioningReady, true);
  assert.equal(calls.length, 4);
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
    if (queries.length === 3) return [astroReady];
    if (queries.length === 4) return [completeReady];
    if (options.body.read_only) return [protections];
    return [];
  });
  assert.equal(result.status, 'metadata-permission-and-provisioning-policy-ready');
  assert.ok(queries.some((query) => query.query.includes('Conflicting immutable release')));
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
    if (queries.length === 3) return [astroReady];
    if (queries.length === 4) return [completeReady];
    if (options.body.read_only) return [protections];
    return [];
  });
  assert.ok(queries.some((query) => query.query.includes('sanity_provisioning_jobs')));
  assert.ok(queries.some((query) => query.query.includes('integration_credentials')));
  assert.ok(!queries.some((query) => /delete|truncate|drop table/i.test(query.query)));
});

test('apply installs the reviewed Astro provisioning migration only when fully absent', async () => {
  const queries = [];
  await configureTemplateGovernance('apply', async (_path, options) => {
    queries.push(options.body);
    if (queries.length === 1) return [ready];
    if (queries.length === 2) return [provisioningReady];
    if (queries.length === 3)
      return [Object.fromEntries(Object.keys(astroReady).map((key) => [key, false]))];
    if (queries.length === 4) return [completeReady];
    if (options.body.read_only) return [protections];
    return [];
  });
  assert.ok(queries.some((query) => query.query.includes('astro_provisioning_jobs')));
  assert.ok(queries.some((query) => query.query.includes('admin_confirm_astro_source')));
  assert.ok(!queries.some((query) => /delete|truncate|drop table/i.test(query.query)));
});

test('apply installs the complete provisioning migration only when fully absent', async () => {
  const queries = [];
  await configureTemplateGovernance('apply', async (_path, options) => {
    queries.push(options.body);
    if (queries.length === 1) return [ready];
    if (queries.length === 2) return [provisioningReady];
    if (queries.length === 3) return [astroReady];
    if (queries.length === 4)
      return [Object.fromEntries(Object.keys(completeReady).map((key) => [key, false]))];
    if (options.body.read_only) return [protections];
    return [];
  });
  assert.ok(queries.some((query) => query.query.includes('restaurant_provisioning_jobs')));
  assert.ok(queries.some((query) => query.query.includes('restaurant_domains')));
  assert.ok(!queries.some((query) => /delete|truncate|drop table/i.test(query.query)));
});
