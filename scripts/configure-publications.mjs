import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { managementApi, inspectQuery, targetFromRows } from './salitre-production.mjs';
const repository = 'EduardoCR90/restaurant-premium-sanity';
const repositoryId = '1432064342';
export async function configurePublications(operation, api) {
  assert.ok(['inspect', 'apply'].includes(operation));
  const target = targetFromRows(
    await api('database/query', { method: 'POST', body: { query: inspectQuery, read_only: true } }),
  );
  const targetRows = await api('database/query', {
    method: 'POST',
    body: {
      query: `select external_dataset from public.restaurant_integrations where id='${target.integrationId}'::uuid`,
      read_only: true,
    },
  });
  assert.equal(targetRows[0]?.external_dataset, 'production');
  const schema = await api('database/query', {
    method: 'POST',
    body: {
      query:
        "select to_regclass('public.website_deployments') is not null as configurations, to_regclass('public.publication_operations') is not null as operations, to_regclass('public.website_deployment_runs') is not null as runs",
      read_only: true,
    },
  });
  const existing = Object.values(schema[0]);
  assert.ok(
    existing.every((x) => x === true) || existing.every((x) => x === false),
    'Esquema parcial: revisar manualmente sin sobrescribir',
  );
  if (operation === 'inspect')
    return { status: 'inspected-read-only', schemaReady: existing.every(Boolean), repository };
  if (existing.every((x) => x === false)) {
    const migration = await readFile(
      new URL('../supabase/migrations/202610310002_publications.sql', import.meta.url),
      'utf8',
    );
    await api('database/query', { method: 'POST', body: { query: migration } });
  }
  // Solo inserción de la configuración de la integración existente. Nunca se actualiza otra fila.
  const sql = `do $$ begin
   if not exists(select 1 from public.restaurant_integrations where id='${target.integrationId}'::uuid and restaurant_id='${target.restaurantId}'::uuid and external_project_id='hfa8zkyw' and external_dataset='production') then raise exception 'Integration changed'; end if;
   if exists(select 1 from public.website_deployments where integration_id='${target.integrationId}'::uuid) then
    if not exists(select 1 from public.website_deployments where integration_id='${target.integrationId}'::uuid and restaurant_id='${target.restaurantId}'::uuid and project_id='hfa8zkyw' and dataset='production' and repository='${repository}' and repository_id='${repositoryId}' and site_url='https://eduardocr90.github.io/restaurant-premium-sanity/' and enabled) then raise exception 'Configuration conflict'; end if;
   else
    insert into public.website_deployments(restaurant_id,integration_id,project_id,dataset,repository,repository_id,site_url) values('${target.restaurantId}'::uuid,'${target.integrationId}'::uuid,'hfa8zkyw','production','${repository}','${repositoryId}','https://eduardocr90.github.io/restaurant-premium-sanity/');
   end if;
  end $$;`;
  await api('database/query', { method: 'POST', body: { query: sql } });
  const checks = await api('database/query', {
    method: 'POST',
    body: {
      query: `select count(*)::int as configured from public.website_deployments where restaurant_id='${target.restaurantId}'::uuid and integration_id='${target.integrationId}'::uuid and repository='${repository}' and enabled`,
      read_only: true,
    },
  });
  assert.equal(checks[0]?.configured, 1);
  return { status: 'configured-metadata-only', repository };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.equal(process.env.GITHUB_REPOSITORY, 'EduardoCR90/restaurant-platform-dashboard');
    assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
    console.log(
      JSON.stringify(
        await configurePublications(
          process.env.PUBLICATION_OPERATION,
          managementApi(process.env.SUPABASE_ACCESS_TOKEN),
        ),
      ),
    );
  } catch {
    console.error(
      'Configuración detenida: integración, esquema, permisos o conexión no verificados. Sin sobrescrituras, respuestas privadas ni reintentos.',
    );
    process.exitCode = 1;
  }
}
