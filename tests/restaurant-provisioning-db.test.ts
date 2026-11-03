// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = id(1);
const client = id(2);
const outsider = id(3);
const request = id(10);
const sanityRequest = id(11);
const astroRequest = id(12);
const restaurant = id(20);
const integration = id(21);
const deployment = id(22);
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
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;`,
  );
  for (const migration of [
    '202610310001_platform.sql',
    '202610310002_publications.sql',
    '202611010001_template_governance.sql',
    '202611010002_sanity_provisioning.sql',
    '202611010003_astro_provisioning.sql',
    '202611020001_restaurant_provisioning.sql',
    '202611030001_hybrid_sanity_admin.sql',
  ])
    await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
  await db.exec(`insert into auth.users values('${admin}','admin@example.com'),('${client}','client@example.com'),('${outsider}','other@example.com');
    insert into app_private.platform_administrators(user_id) values('${admin}');`);
  await db.query(
    'insert into public.template_releases select * from jsonb_populate_record(null::public.template_releases,$1)',
    [release],
  );
}, 30_000);

afterAll(async () => db?.close());

async function asUser<T>(user: string, fn: () => Promise<T>) {
  await db.exec('begin');
  try {
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    return await fn();
  } finally {
    await db.exec('rollback');
  }
}

const payload = (overrides: Record<string, unknown> = {}) => ({
  request_id: request,
  request_hash: 'c'.repeat(64),
  name: 'Burger House',
  slug: 'burger-house',
  client_email: 'client@example.com',
  client_role: 'restaurant_owner',
  template_key: release.template_key,
  template_version: release.version,
  visual: { preset: 'casual' },
  modules: [{ key: 'content_management', granted: true, enabled: true }],
  custom_domain: 'www.burger-house.example',
  domain_mode: 'subdomain',
  sanity_request_id: sanityRequest,
  astro_request_id: astroRequest,
  ...overrides,
});

async function claim(operation: 'start' | 'retry' | 'status', input = payload()) {
  const result = await db.query<{ result: Record<string, unknown> }>(
    'select public.admin_claim_restaurant_provisioning($1,$2,$3) as result',
    [admin, operation, input],
  );
  return result.rows[0].result as {
    execute: boolean;
    lease_token: string;
    job: Record<string, unknown>;
  };
}

describe('complete provisioning persistence and tenant isolation', () => {
  it('allows only active Super Admin through service-role RPCs', async () => {
    await expect(
      db.query('select public.admin_claim_restaurant_provisioning($1,$2,$3)', [
        client,
        'start',
        payload(),
      ]),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      asUser(client, () =>
        db.query('select public.admin_claim_restaurant_provisioning($1,$2,$3)', [
          client,
          'start',
          payload(),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(client, () => db.query('select * from public.restaurant_provisioning_jobs')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(client, () =>
        db.query('select public.admin_resume_restaurant_sanity_admin($1,$2)', [client, request]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('registers one immutable plan without creating provider resources', async () => {
    const first = await claim('start');
    expect(first).toMatchObject({ execute: true, job: { status: 'running', stage: 'sanity' } });
    const duplicate = await claim('start');
    expect(duplicate).toMatchObject({ execute: false });
    await expect(claim('start', payload({ request_hash: 'd'.repeat(64) }))).rejects.toThrow(
      /Idempotency conflict/,
    );
    const resources = await db.query<{ restaurants: number; integrations: number }>(
      'select (select count(*)::int from public.restaurants) restaurants,(select count(*)::int from public.restaurant_integrations) integrations',
    );
    expect(resources.rows[0]).toEqual({ restaurants: 0, integrations: 0 });
  });

  it('accepts an omitted domain and validates the client email again in SQL', async () => {
    const withoutDomain = payload({
      request_id: id(30),
      request_hash: '4'.repeat(64),
      slug: 'burger-house-dos',
      custom_domain: '',
      domain_mode: '',
      sanity_request_id: id(31),
      astro_request_id: id(32),
    });
    const created = await db.query<{ result: { job: { domain: null } } }>(
      'select public.admin_claim_restaurant_provisioning($1,$2,$3) as result',
      [admin, 'start', withoutDomain],
    );
    expect(created.rows[0].result.job.domain).toBeNull();
    await expect(
      db.query('select public.admin_claim_restaurant_provisioning($1,$2,$3)', [
        admin,
        'start',
        payload({
          request_id: id(33),
          request_hash: '5'.repeat(64),
          slug: 'burger-house-tres',
          client_email: 'invalid-email',
          sanity_request_id: id(34),
          astro_request_id: id(35),
        }),
      ]),
    ).rejects.toThrow(/Invalid provisioning request/);
  });

  it('reanuda la solicitud agregada solo cuando su hijo exacto espera al administrador', async () => {
    const parentRequest = id(40);
    const childRequest = id(41);
    const parent = await db.query<{ result: { lease_token: string } }>(
      'select public.admin_claim_restaurant_provisioning($1,$2,$3) as result',
      [
        admin,
        'start',
        payload({
          request_id: parentRequest,
          request_hash: '6'.repeat(64),
          slug: 'admin-pause-restaurant',
          sanity_request_id: childRequest,
          astro_request_id: id(42),
          custom_domain: '',
          domain_mode: '',
        }),
      ],
    );
    const child = await db.query<{ result: { lease_token: string } }>(
      'select public.admin_claim_sanity_provisioning($1,$2,$3) as result',
      [
        admin,
        'start',
        {
          request_id: childRequest,
          request_hash: '7'.repeat(64),
          name: 'Admin pause restaurant',
          slug: 'admin-pause-restaurant',
          project_id: 'r7234567890abcde',
          dataset: 'production',
        },
      ],
    );
    await db.query('select public.admin_pause_sanity_admin($1,$2,$3,$4)', [
      admin,
      childRequest,
      child.rows[0].result.lease_token,
      'project77',
    ]);
    await db.query('select public.admin_wait_restaurant_provisioning($1,$2,$3)', [
      admin,
      parentRequest,
      parent.rows[0].result.lease_token,
    ]);
    const resumed = await db.query<{ result: { execute: boolean; job: { status: string } } }>(
      'select public.admin_resume_restaurant_sanity_admin($1,$2) as result',
      [admin, parentRequest],
    );
    expect(resumed.rows[0].result).toMatchObject({ execute: true, job: { status: 'running' } });
    await expect(
      db.query('select public.admin_resume_restaurant_sanity_admin($1,$2)', [admin, parentRequest]),
    ).rejects.toThrow(/not available/);
  });

  it('accepts matching child evidence and activates the client only after both complete', async () => {
    await db.exec(`insert into public.restaurants(id,name,slug,status) values('${restaurant}','Burger House','burger-house','pending');
      insert into public.restaurant_integrations(id,restaurant_id,provider,external_project_id,external_dataset) values('${integration}','${restaurant}','sanity','r1234567890abcde','production');
      insert into public.sanity_provisioning_jobs(request_id,request_hash,restaurant_id,integration_id,name,slug,project_id,dataset,status,stage,retryable)
       values('${sanityRequest}','${'e'.repeat(64)}','${restaurant}','${integration}','Burger House','burger-house','r1234567890abcde','production','succeeded','completed',false);`);
    const lease = (
      await db.query<{ lease_token: string }>(
        'select lease_token from public.restaurant_provisioning_jobs where request_id=$1',
        [request],
      )
    ).rows[0].lease_token;
    await db.query('select public.admin_checkpoint_restaurant_provisioning($1,$2,$3,$4,$5)', [
      admin,
      request,
      lease,
      'astro',
      { restaurant_id: restaurant, integration_id: integration },
    ]);
    await db.exec(`insert into public.website_deployments(id,restaurant_id,integration_id,project_id,dataset,repository,repository_id,site_url)
       values('${deployment}','${restaurant}','${integration}','r1234567890abcde','production','TestOwner/burger-house-restaurant','987654','https://testowner.github.io/burger-house-restaurant/');
      insert into public.restaurant_websites(restaurant_id,deployment_id,desired_template_key,desired_version,custom_domain,custom_domain_status)
       values('${restaurant}','${deployment}','restaurant-editorial','0.4.0','www.burger-house.example','unverified');
      insert into public.restaurant_module_entitlements(restaurant_id,module_key,granted) values('${restaurant}','content_management',true);
      insert into public.restaurant_modules(restaurant_id,module_key,enabled) values('${restaurant}','content_management',true);
      insert into public.astro_provisioning_jobs(request_id,request_hash,sanity_request_id,restaurant_id,integration_id,template_key,template_version,source_template_commit,distribution_hash,visual,modules,custom_domain,repository,repository_id,visibility,site_url,base_path,publication_endpoint,provisioning_endpoint,specification_hash,source_commit,manifest_hash,deployment_id,status,stage,created_by)
       values('${astroRequest}','${'f'.repeat(64)}','${sanityRequest}','${restaurant}','${integration}','restaurant-editorial','0.4.0','${release.source_commit}','${release.distribution_hash}','{"preset":"casual"}','[{"key":"content_management","granted":true,"enabled":true}]','www.burger-house.example','TestOwner/burger-house-restaurant','987654','private','https://testowner.github.io/burger-house-restaurant/','/burger-house-restaurant','https://platform.example/functions/v1/publications','https://platform.example/functions/v1/astro-provisioning','${'1'.repeat(64)}','${'2'.repeat(40)}','${'3'.repeat(64)}','${deployment}','succeeded','completed','${admin}');`);
    await db.query('select public.admin_checkpoint_restaurant_provisioning($1,$2,$3,$4,$5)', [
      admin,
      request,
      lease,
      'client_invitation',
      {
        repository: 'TestOwner/burger-house-restaurant',
        site_url: 'https://testowner.github.io/burger-house-restaurant/',
      },
    ]);
    const prepared = await db.query<{ result: Record<string, unknown> }>(
      'select public.admin_prepare_restaurant_invitation($1,$2,$3) as result',
      [admin, request, lease],
    );
    expect(prepared.rows[0].result).toMatchObject({ client_user_id: client });
    const completed = await db.query<{ result: Record<string, unknown> }>(
      'select public.admin_complete_restaurant_provisioning($1,$2,$3,$4) as result',
      [admin, request, lease, client],
    );
    expect(completed.rows[0].result).toMatchObject({
      status: 'succeeded',
      stage: 'completed',
      site_url: 'https://testowner.github.io/burger-house-restaurant/',
      dns: { status: 'dns_pending', target: 'testowner.github.io' },
    });
    const state = await db.query<{
      status: string;
      role: string;
      membership_status: string;
      invitation_status: string;
      hostname: string;
      mode: string;
      target: string;
      records: unknown;
    }>(
      `select r.status,m.role,m.status membership_status,i.status invitation_status,d.hostname,d.mode,d.target,d.records
       from public.restaurants r join public.restaurant_memberships m on m.restaurant_id=r.id
       join public.restaurant_invitations i on i.restaurant_id=r.id
       join public.restaurant_domains d on d.restaurant_id=r.id where r.id=$1`,
      [restaurant],
    );
    expect(state.rows[0]).toMatchObject({
      status: 'active',
      role: 'restaurant_owner',
      membership_status: 'active',
      invitation_status: 'sent',
      hostname: 'www.burger-house.example',
      mode: 'subdomain',
      target: 'testowner.github.io',
    });
    expect(state.rows[0].records).toEqual([
      { type: 'CNAME', name: 'www.burger-house.example', value: 'testowner.github.io' },
    ]);
  });

  it('shows DNS only to the assigned tenant and never grants web creation controls', async () => {
    await expect(
      asUser(client, () => db.query('select hostname,status from public.restaurant_domains')),
    ).resolves.toMatchObject({
      rows: [{ hostname: 'www.burger-house.example', status: 'dns_pending' }],
    });
    await expect(
      asUser(outsider, () => db.query('select hostname from public.restaurant_domains')),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      asUser(client, () =>
        db.query('select public.admin_list_restaurant_provisioning($1,$2)', [client, 20]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
