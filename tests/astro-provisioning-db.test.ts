// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = id(1);
const owner = id(2);
const suspendedAdmin = id(3);
const sanityRequest = id(10);
const restaurant = id(11);
const integration = id(12);
const request = id(20);
const release = {
  template_key: 'restaurant-editorial',
  version: '0.4.0',
  source_commit: 'a'.repeat(40),
  distribution_hash: 'b'.repeat(64),
  configuration_contract: 1,
  content_contract: 'salitre-v1',
  visual_contract: 2,
};
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;`,
  );
  for (const migration of [
    '202610310001_platform.sql',
    '202610310002_publications.sql',
    '202611010001_template_governance.sql',
    '202611010002_sanity_provisioning.sql',
    '202611010003_astro_provisioning.sql',
    '202611020001_restaurant_provisioning.sql',
    '202611030001_hybrid_sanity_admin.sql',
    '202611050001_astro_hybrid_sanity_evidence.sql',
  ])
    await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
  await db.exec(`insert into auth.users values('${admin}'),('${owner}'),('${suspendedAdmin}');
    insert into app_private.platform_administrators(user_id) values('${admin}'),('${suspendedAdmin}');
    update public.profiles set status='suspended' where id='${suspendedAdmin}';`);
  await db.query(
    'insert into public.template_releases select * from jsonb_populate_record(null::public.template_releases,$1)',
    [release],
  );
  await db.exec(`insert into public.restaurants(id,name,slug,status) values('${restaurant}','Nuevo Restaurante','nuevo-restaurante','pending');
    insert into public.restaurant_integrations(id,restaurant_id,provider,external_project_id,external_dataset) values('${integration}','${restaurant}','sanity','lvtvr3ef','production');
    insert into public.sanity_provisioning_jobs(request_id,request_hash,restaurant_id,integration_id,name,slug,project_id,external_project_id,dataset,status,stage,retryable)
    values('${sanityRequest}','${'c'.repeat(64)}','${restaurant}','${integration}','Nuevo Restaurante','nuevo-restaurante','ra138101d442db33','lvtvr3ef','production','succeeded','completed',false);`);
}, 30_000);

afterAll(async () => db?.close());

async function asUser<T>(
  user: string | null,
  role: 'authenticated' | 'anon',
  fn: () => Promise<T>,
) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || '']);
    return await fn();
  } finally {
    await db.exec('rollback');
  }
}

const startPayload = (overrides: Record<string, unknown> = {}) => ({
  request_id: request,
  request_hash: 'd'.repeat(64),
  sanity_request_id: sanityRequest,
  template_key: release.template_key,
  template_version: release.version,
  visual: { preset: 'elegant' },
  modules: [{ key: 'content_management', granted: true, enabled: true }],
  custom_domain: 'www.nuevo-restaurante.example',
  repository_owner: 'TestOwner',
  visibility: 'private',
  publication_endpoint: 'https://platform.example/functions/v1/publications',
  provisioning_endpoint: 'https://platform.example/functions/v1/astro-provisioning',
  ...overrides,
});

type Claim = {
  execute: boolean;
  lease_token: string | null;
  job: Record<string, unknown>;
};
async function claim(operation: 'start' | 'retry', payload: Record<string, unknown>) {
  const result = await db.query<{ result: Claim }>(
    'select public.admin_claim_astro_provisioning($1,$2,$3) as result',
    [admin, operation, payload],
  );
  return result.rows[0].result;
}

describe('Astro provisioning persistence and isolation', () => {
  it('denies clients, anonymous users and suspended platform administrators', async () => {
    await expect(
      asUser(owner, 'authenticated', () =>
        db.query('select public.admin_claim_astro_provisioning($1,$2,$3)', [
          owner,
          'start',
          startPayload(),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query('select public.admin_claim_astro_provisioning($1,$2,$3)', [
        owner,
        'start',
        startPayload(),
      ]),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      db.query('select public.admin_claim_astro_provisioning($1,$2,$3)', [
        suspendedAdmin,
        'start',
        startPayload(),
      ]),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      asUser(owner, 'authenticated', () =>
        db.query('select * from public.astro_provisioning_jobs'),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('resolves Sanity, release, repository and Pages identity on the server exactly once', async () => {
    const first = await claim('start', startPayload());
    expect(first.execute).toBe(true);
    expect(first.job).toMatchObject({
      restaurant_id: restaurant,
      integration_id: integration,
      repository: 'TestOwner/nuevo-restaurante-restaurant',
      site_url: 'https://testowner.github.io/nuevo-restaurante-restaurant/',
      base_path: '/nuevo-restaurante-restaurant',
      status: 'running',
      stage: 'queued',
    });
    const duplicate = await claim('start', startPayload());
    expect(duplicate).toMatchObject({ execute: false });
    await expect(claim('start', startPayload({ request_hash: 'e'.repeat(64) }))).rejects.toThrow(
      /changed/,
    );
  });

  it('separates repository creation, explicit dispatch recovery and OIDC source confirmation', async () => {
    const row = await db.query<{ lease_token: string }>(
      'select lease_token from public.astro_provisioning_jobs where request_id=$1',
      [request],
    );
    const lease = row.rows[0].lease_token;
    const checkpoint = await db.query<{ result: Record<string, unknown> }>(
      'select public.admin_checkpoint_astro_provisioning($1,$2,$3,$4,$5) as result',
      [
        admin,
        request,
        lease,
        'repository_created',
        { repository_id: '987654', specification_hash: 'f'.repeat(64) },
      ],
    );
    expect(checkpoint.rows[0].result).toMatchObject({
      stage: 'repository_created',
      repository_id: '987654',
    });
    const waiting = await db.query<{ result: Record<string, unknown> }>(
      'select public.admin_await_astro_callback($1,$2,$3) as result',
      [admin, request, lease],
    );
    expect(waiting.rows[0].result).toMatchObject({ stage: 'initialization_dispatched' });
    const retry = await claim('retry', { request_id: request });
    expect(retry.job).toMatchObject({ stage: 'initialization_dispatched', attempt_count: 2 });
    await db.query('select public.admin_await_astro_callback($1,$2,$3)', [
      admin,
      request,
      retry.lease_token,
    ]);
    await expect(
      db.query('select public.admin_confirm_astro_source($1,$2,$3,$4,$5)', [
        request,
        'attacker/other',
        '987654',
        '1'.repeat(40),
        '2'.repeat(64),
      ]),
    ).rejects.toThrow(/identity mismatch/);
    const confirmed = await db.query<{ result: Claim }>(
      'select public.admin_confirm_astro_source($1,$2,$3,$4,$5) as result',
      [request, 'TestOwner/nuevo-restaurante-restaurant', '987654', '1'.repeat(40), '2'.repeat(64)],
    );
    expect(confirmed.rows[0].result).toMatchObject({
      execute: true,
      job: { stage: 'source_ready' },
    });
  });

  it('registers deployment, desired version and modules atomically without activating the restaurant', async () => {
    const current = await db.query<{ lease_token: string }>(
      'select lease_token from public.astro_provisioning_jobs where request_id=$1',
      [request],
    );
    const result = await db.query<{ result: Record<string, unknown> }>(
      'select public.admin_complete_astro_provisioning($1,$2,$3,$4) as result',
      [
        admin,
        request,
        current.rows[0].lease_token,
        'https://testowner.github.io/nuevo-restaurante-restaurant/',
      ],
    );
    expect(result.rows[0].result).toMatchObject({ status: 'succeeded', stage: 'completed' });
    expect(result.rows[0].result).toMatchObject({ project_id: 'lvtvr3ef' });
    const state = await db.query(
      `select r.status,w.desired_version,w.installed_version,w.custom_domain,w.custom_domain_status,
       d.repository,d.repository_id,d.site_url,e.granted,m.enabled
       from public.restaurants r join public.restaurant_websites w on w.restaurant_id=r.id
       join public.website_deployments d on d.id=w.deployment_id
       join public.restaurant_module_entitlements e on e.restaurant_id=r.id and e.module_key='content_management'
       join public.restaurant_modules m on m.restaurant_id=r.id and m.module_key=e.module_key where r.id=$1`,
      [restaurant],
    );
    expect(state.rows).toEqual([
      {
        status: 'pending',
        desired_version: '0.4.0',
        installed_version: null,
        custom_domain: 'www.nuevo-restaurante.example',
        custom_domain_status: 'unverified',
        repository: 'TestOwner/nuevo-restaurante-restaurant',
        repository_id: '987654',
        site_url: 'https://testowner.github.io/nuevo-restaurante-restaurant/',
        granted: true,
        enabled: true,
      },
    ]);
    await expect(claim('retry', { request_id: request })).resolves.toMatchObject({
      execute: false,
      job: { status: 'succeeded' },
    });
  });

  it('does not alter Salitre or create an installed version without a signed deployment build', async () => {
    const salitre = await db.query<{ count: number }>(
      "select count(*)::int as count from public.restaurant_integrations where external_project_id='hfa8zkyw'",
    );
    expect(salitre.rows[0].count).toBe(0);
    const website = await db.query(
      'select installed_version,verified_run_id from public.restaurant_websites where restaurant_id=$1',
      [restaurant],
    );
    expect(website.rows).toEqual([{ installed_version: null, verified_run_id: null }]);
  });
});
