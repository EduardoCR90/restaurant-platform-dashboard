import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { managementApi } from './salitre-production.mjs';
export async function configureTemplateGovernance(operation, api) {
  assert.ok(['inspect', 'apply'].includes(operation));
  const schemaQuery =
    "select to_regclass('public.template_releases') is not null as releases, to_regclass('public.restaurant_websites') is not null as websites, to_regclass('public.website_template_builds') is not null as builds, to_regprocedure('public.admin_website_configure(uuid,text,jsonb)') is not null as admin_rpc, to_regprocedure('public.report_template_build(uuid,text,integer,text,text,jsonb)') is not null as report_rpc";
  const schema = await api('database/query', {
    method: 'POST',
    body: { query: schemaQuery, read_only: true },
  });
  const values = Object.values(schema[0]);
  assert.equal(values.length, 5);
  assert.ok(
    values.every((v) => v === true) || values.every((v) => v === false),
    'Partial governance schema; stop for review',
  );
  if (operation === 'inspect')
    return { status: 'inspected-read-only', schemaReady: values.every(Boolean) };
  const catalog = JSON.parse(
    await readFile(new URL('../ops/template-releases.json', import.meta.url), 'utf8'),
  );
  assert.ok(Array.isArray(catalog) && catalog.length > 0);
  for (const release of catalog) {
    assert.match(release.template_key, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(release.version, /^\d+\.\d+\.\d+$/);
    assert.match(release.source_commit, /^[a-f0-9]{40}$/);
    assert.match(release.distribution_hash, /^[a-f0-9]{64}$/);
    assert.equal(release.configuration_contract, 1);
    assert.equal(release.content_contract, 'salitre-v1');
    assert.equal(release.visual_contract, 2);
  }
  if (values.every((v) => v === false))
    await api('database/query', {
      method: 'POST',
      body: {
        query: await readFile(
          new URL('../supabase/migrations/202611010001_template_governance.sql', import.meta.url),
          'utf8',
        ),
      },
    });

  // Catalog is reviewed code, not HTTP input. Refuse conflicting immutable releases.
  const rows = catalog
    .map(
      (r) =>
        `('${r.template_key}','${r.version}','${r.source_commit}','${r.distribution_hash}',1,'salitre-v1',2)`,
    )
    .join(',');
  const sql = `begin; create temporary table approved_releases (like public.template_releases including all) on commit drop; insert into approved_releases values ${rows};
    do $$ begin if exists(select 1 from approved_releases a join public.template_releases r using(template_key,version) where to_jsonb(a)<>to_jsonb(r)) then raise exception 'Conflicting immutable release';end if;end $$;
    insert into public.template_releases select * from approved_releases on conflict do nothing; commit;`;
  await api('database/query', { method: 'POST', body: { query: sql } });
  const checks = await api('database/query', {
    method: 'POST',
    body: {
      query:
        "select not has_column_privilege('authenticated','public.restaurant_modules','enabled','UPDATE') as modules_protected, has_function_privilege('service_role','public.admin_website_configure(uuid,text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.admin_website_configure(uuid,text,jsonb)','EXECUTE') as admin_protected",
      read_only: true,
    },
  });
  assert.equal(checks[0]?.modules_protected, true);
  assert.equal(checks[0]?.admin_protected, true);
  return { status: 'metadata-and-permission-policy-ready', approvedReleases: catalog.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
    assert.ok(['workflow_dispatch', 'workflow_run'].includes(process.env.GITHUB_EVENT_NAME));
    const validated = process.env.GOVERNANCE_VALIDATED_SHA;
    assert.match(validated || '', /^[a-f0-9]{40}$/);
    assert.equal(validated, process.env.GITHUB_SHA);
    assert.equal(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
      validated,
    );
    assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
    assert.equal(process.env.GITHUB_REPOSITORY, 'EduardoCR90/restaurant-platform-dashboard');
    console.log(
      JSON.stringify(
        await configureTemplateGovernance(
          process.env.GOVERNANCE_OPERATION,
          managementApi(process.env.SUPABASE_ACCESS_TOKEN),
        ),
      ),
    );
  } catch {
    console.error(
      'Governance configuration stopped: schema, release identity, permission or connection not verified. No CMS writes, bootstrap or automatic retries.',
    );
    process.exitCode = 1;
  }
}
