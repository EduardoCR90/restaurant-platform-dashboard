// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = id(1);
const owner = id(2);
const suspendedAdmin = id(3);
const salitre = id(10);
const salitreIntegration = id(11);
const request = id(20);
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
  ])
    await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
  await db.exec(`insert into auth.users values('${admin}'),('${owner}'),('${suspendedAdmin}');
    insert into app_private.platform_administrators(user_id) values('${admin}'),('${suspendedAdmin}');
    update public.profiles set status='suspended' where id='${suspendedAdmin}';
    insert into public.restaurants(id,name,slug,status) values('${salitre}','Salitre','salitre','active');
    insert into public.restaurant_integrations(id,restaurant_id,provider,external_project_id,external_dataset) values('${salitreIntegration}','${salitre}','sanity','hfa8zkyw','production');`);
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
  request_hash: 'a'.repeat(64),
  name: 'Nuevo restaurante',
  slug: 'nuevo-restaurante',
  project_id: 'r1234567890abcde',
  dataset: 'production',
  ...overrides,
});

type ClaimResult = {
  execute: boolean;
  lease_token: string | null;
  job: {
    restaurant_id: string;
    status: string;
    stage: string;
    attempt_count: number;
  };
};
async function claim(operation: 'start' | 'retry', payload: Record<string, unknown>) {
  const result = await db.query<{ result: ClaimResult }>(
    'select public.admin_claim_sanity_provisioning($1,$2,$3) as result',
    [admin, operation, payload],
  );
  return result.rows[0].result;
}

describe('persistencia y permisos de aprovisionamiento', () => {
  it('solo service_role con Super Admin activo puede iniciar; el cliente no accede a trabajos o secretos', async () => {
    await expect(
      asUser(owner, 'authenticated', () =>
        db.query('select public.admin_claim_sanity_provisioning($1,$2,$3)', [
          owner,
          'start',
          startPayload(),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query('select public.admin_claim_sanity_provisioning($1,$2,$3)', [
        owner,
        'start',
        startPayload(),
      ]),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      db.query('select public.admin_claim_sanity_provisioning($1,$2,$3)', [
        suspendedAdmin,
        'start',
        startPayload(),
      ]),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      asUser(owner, 'authenticated', () =>
        db.query('select * from public.sanity_provisioning_jobs'),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, 'authenticated', () =>
        db.query('select * from public.integration_credentials'),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('crea un restaurante pending una vez y rechaza reutilizar request_id con otro contrato', async () => {
    const first = await claim('start', startPayload());
    expect(first.execute).toBe(true);
    expect(first.job).toMatchObject({ status: 'running', stage: 'queued', attempt_count: 1 });
    const duplicate = await claim('start', startPayload());
    expect(duplicate).toMatchObject({ execute: false });
    expect(duplicate.job.restaurant_id).toBe(first.job.restaurant_id);
    await expect(
      claim('start', startPayload({ request_hash: 'b'.repeat(64), name: 'Otro' })),
    ).rejects.toThrow(/Idempotency conflict/);
    const restaurants = await db.query(
      "select name,slug,status from public.restaurants where slug='nuevo-restaurante'",
    );
    expect(restaurants.rows).toEqual([
      { name: 'Nuevo restaurante', slug: 'nuevo-restaurante', status: 'pending' },
    ]);
  });

  it('registra checkpoints y completa integración+credencial en una sola transacción', async () => {
    const current = await db.query<{ lease_token: string }>(
      'select lease_token from public.sanity_provisioning_jobs where request_id=$1',
      [request],
    );
    const lease = current.rows[0].lease_token;
    for (const stage of ['project_ready', 'dataset_ready', 'credential_pending'])
      await db.query('select public.admin_checkpoint_sanity_provisioning($1,$2,$3,$4)', [
        admin,
        request,
        lease,
        stage,
      ]);
    const result = await db.query<{ result: Record<string, unknown> }>(
      'select public.admin_complete_sanity_provisioning($1,$2,$3,$4,$5) as result',
      [
        admin,
        request,
        lease,
        'provider-token-id',
        { key_version: 'v1', ciphertext: 'abc_DEF', iv: 'nonce_123' },
      ],
    );
    expect(result.rows[0].result).toMatchObject({ status: 'succeeded', stage: 'completed' });
    const integration = await db.query(
      `select r.status,i.external_project_id,i.external_dataset,c.key_version
       from public.sanity_provisioning_jobs j join public.restaurants r on r.id=j.restaurant_id
       join public.restaurant_integrations i on i.id=j.integration_id
       join public.integration_credentials c on c.integration_id=i.id where j.request_id=$1`,
      [request],
    );
    expect(integration.rows).toEqual([
      {
        status: 'pending',
        external_project_id: 'r1234567890abcde',
        external_dataset: 'production',
        key_version: 'v1',
      },
    ]);
    await expect(claim('retry', { request_id: request })).rejects.toThrow(/not safely retryable/);
  });

  it('permite recuperación explícita solo de fallos seguros y bloquea estados ambiguos', async () => {
    const retryRequest = id(21);
    const started = await claim(
      'start',
      startPayload({
        request_id: retryRequest,
        request_hash: 'c'.repeat(64),
        slug: 'retry-restaurant',
        project_id: 'r2234567890abcde',
      }),
    );
    await db.query('select public.admin_fail_sanity_provisioning($1,$2,$3,$4,$5,$6)', [
      admin,
      retryRequest,
      started.lease_token,
      'connection',
      true,
      false,
    ]);
    const retried = await claim('retry', { request_id: retryRequest });
    expect(retried.job).toMatchObject({ status: 'running', attempt_count: 2 });
    await db.query('select public.admin_fail_sanity_provisioning($1,$2,$3,$4,$5,$6)', [
      admin,
      retryRequest,
      retried.lease_token,
      'credential_ambiguous',
      false,
      true,
    ]);
    await expect(claim('retry', { request_id: retryRequest })).rejects.toThrow(
      /not safely retryable/,
    );
  });

  it('convierte un lease vencido en fallo recuperable sin repetir llamadas externas', async () => {
    const expiredRequest = id(22);
    await claim(
      'start',
      startPayload({
        request_id: expiredRequest,
        request_hash: 'd'.repeat(64),
        slug: 'expired-restaurant',
        project_id: 'r3234567890abcde',
      }),
    );
    await db.query(
      "update public.sanity_provisioning_jobs set lease_expires_at=now()-interval '1 second' where request_id=$1",
      [expiredRequest],
    );
    const status = await db.query<{ result: Record<string, unknown> }>(
      'select public.admin_get_sanity_provisioning($1,$2) as result',
      [admin, expiredRequest],
    );
    expect(status.rows[0].result).toMatchObject({
      status: 'failed',
      retryable: true,
      error_code: 'connection',
    });
    const retried = await claim('retry', { request_id: expiredRequest });
    expect(retried.job.attempt_count).toBe(2);
  });

  it('mantiene intacta la integración existente de Salitre', async () => {
    const row = await db.query(
      'select id,restaurant_id,external_project_id,external_dataset from public.restaurant_integrations where id=$1',
      [salitreIntegration],
    );
    expect(row.rows).toEqual([
      {
        id: salitreIntegration,
        restaurant_id: salitre,
        external_project_id: 'hfa8zkyw',
        external_dataset: 'production',
      },
    ]);
  });
});
