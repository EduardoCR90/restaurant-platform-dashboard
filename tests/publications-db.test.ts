// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const a = id(1),
  b = id(2),
  owner = id(3),
  other = id(4),
  staff = id(5),
  ia = id(6),
  ib = id(7),
  da = id(8),
  dbb = id(9);
let seq = 100;
const hash = (s: string) => s.repeat(64);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;`,
  );
  await db.exec(await readFile('supabase/migrations/202610310001_platform.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/202610310002_publications.sql', 'utf8'));
  await db.exec(`insert into auth.users values('${owner}'),('${other}'),('${staff}');
 insert into public.restaurants(id,name,slug,status) values('${a}','A','a','active'),('${b}','B','b','active');
 insert into public.restaurant_memberships(restaurant_id,user_id,role) values('${a}','${owner}','restaurant_owner'),('${b}','${other}','restaurant_owner'),('${a}','${staff}','restaurant_staff');
 insert into public.restaurant_module_entitlements(restaurant_id,module_key,granted) values('${a}','content_management',true),('${b}','content_management',true);
 insert into public.restaurant_modules(restaurant_id,module_key,enabled) values('${a}','content_management',true),('${b}','content_management',true);
 insert into public.restaurant_integrations(id,restaurant_id,provider,external_project_id,external_dataset) values('${ia}','${a}','sanity','projecta','production'),('${ib}','${b}','sanity','projectb','production');
 insert into public.website_deployments(id,restaurant_id,integration_id,project_id,dataset,repository,repository_id,site_url) values('${da}','${a}','${ia}','projecta','production','owner/a','123','https://example.test/a/'),('${dbb}','${b}','${ib}','projectb','production','owner/b','456','https://example.test/b/');`);
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function operation(
  fingerprint: string | null,
  previous: string | null = null,
  target = da,
  document = 'doc',
) {
  const operationId = id(seq++);
  await db.query(
    `insert into public.publication_operations(id,restaurant_id,integration_id,deployment_id,actor_id,document_id,action,fingerprint,previous_fingerprint,state,accepted_at) values($1,$2,$3,$4,$5,$6,'publish',$7,$8,$9,case when $7::text is null then null else now() end)`,
    [
      operationId,
      target === da ? a : b,
      target === da ? ia : ib,
      target,
      target === da ? owner : other,
      document,
      fingerprint,
      previous,
      fingerprint ? 'awaiting_deployment' : 'publishing_sanity',
    ],
  );
  return operationId;
}
const report = (run: string, phase: string, hashes: string[] = [], target = da, attempt = 1) =>
  db.query('select public.report_website_deployment($1,$2,$3,$4,$5,$6)', [
    target,
    run,
    attempt,
    'a'.repeat(40),
    phase,
    hashes,
  ]);
async function state(operationId: string) {
  return (
    await db.query<{ state: string; error_code: string; run_id: string }>(
      'select state,error_code,run_id from public.publication_operations where id=$1',
      [operationId],
    )
  ).rows[0];
}
async function asUser(user: string, sql: string, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    return await db.query(sql);
  } finally {
    await db.exec('rollback');
  }
}
describe('publicaciones y despliegues: SQL real sin servicios remotos', () => {
  it('no confirma la web hasta el resultado del despliegue que contiene la revisión', async () => {
    const op = await operation(hash('a'));
    await report('101', 'building');
    expect((await state(op)).state).toBe('awaiting_deployment');
    await report('101', 'ready', [hash('a')]);
    expect((await state(op)).state).toBe('deploying');
    await report('101', 'succeeded', [hash('a')]);
    expect(await state(op)).toMatchObject({ state: 'updated', run_id: '101' });
  });
  it('registra fallo del despliegue sin inventar éxito de la web', async () => {
    const op = await operation(hash('b'));
    await report('102', 'ready', [hash('b')]);
    await report('102', 'failed', [hash('b')]);
    expect(await state(op)).toMatchObject({
      state: 'deployment_error',
      error_code: 'deployment_failed',
    });
  });
  it('agrupa publicaciones simultáneas y encadena revisiones reemplazadas verificablemente', async () => {
    const first = await operation(hash('c'), null, da, 'chain');
    const second = await operation(hash('d'), hash('c'), da, 'chain');
    const third = await operation(hash('e'), null, da, 'another');
    await report('103', 'succeeded', [hash('d'), hash('e')]);
    for (const op of [first, second, third])
      expect(await state(op)).toMatchObject({ state: 'updated', run_id: '103' });
  });
  it('no usa el último run ni una revisión de otro restaurante como correlación', async () => {
    const op = await operation(hash('f'), null, da, 'isolated');
    await report('104', 'succeeded', [hash('1')]);
    await report('105', 'succeeded', [hash('f')], dbb);
    expect((await state(op)).state).toBe('awaiting_deployment');
  });
  it('acepta informes duplicados y fuera de orden sin degradar terminales', async () => {
    const op = await operation(hash('2'));
    await report('106', 'succeeded', [hash('2')]);
    await report('106', 'succeeded', [hash('2')]);
    await report('106', 'building');
    expect((await state(op)).state).toBe('updated');
    await expect(report('106', 'failed', [hash('2')])).rejects.toThrow('Conflicting terminal');
    await expect(report('106', 'ready', [hash('3')])).rejects.toThrow('Build evidence changed');
  });
  it('recupera publicaciones aceptadas después de recibir el informe', async () => {
    await report('107', 'succeeded', [hash('4')]);
    const op = await operation(hash('4'));
    await db.query('select public.reconcile_publications($1)', [da]);
    expect((await state(op)).state).toBe('updated');
  });
  it('expira runs no encontrados y permite recuperar mediante evidencia posterior', async () => {
    const op = await operation(hash('5'));
    await db.query(
      "update public.publication_operations set accepted_at=now()-interval '31 minutes' where id=$1",
      [op],
    );
    await db.query('select public.reconcile_publications($1)', [da]);
    expect(await state(op)).toMatchObject({
      state: 'deployment_error',
      error_code: 'run_not_found',
    });
    await report('108', 'succeeded', [hash('5')]);
    expect((await state(op)).state).toBe('updated');
  });
  it('expira una ejecución en curso y una confirmación Sanity perdida', async () => {
    const op = await operation(hash('6'));
    await report('109', 'ready', [hash('6')]);
    await db.query(
      "update public.publication_operations set accepted_at=now()-interval '31 minutes' where id=$1",
      [op],
    );
    const uncertain = await operation(null);
    await db.query(
      "update public.publication_operations set created_at=now()-interval '3 minutes' where id=$1",
      [uncertain],
    );
    await db.query('select public.reconcile_publications($1)', [da]);
    expect((await state(op)).error_code).toBe('deployment_expired');
    expect((await state(uncertain)).error_code).toBe('sanity_confirmation_missing');
  });
  it('RLS aísla restaurantes y staff; clientes no pueden falsificar registros ni informes', async () => {
    const foreign = await operation(hash('7'), null, dbb);
    expect(
      (await asUser(owner, `select id from public.publication_operations where id='${foreign}'`))
        .rows,
    ).toHaveLength(0);
    expect((await asUser(staff, 'select id from public.publication_operations')).rows).toHaveLength(
      0,
    );
    await expect(
      asUser(owner, "update public.publication_operations set state='updated'"),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(owner, `select public.reconcile_publications('${da}')`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asUser(owner, 'select * from public.website_deployments')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(owner, 'select * from public.publication_operations', 'anon'),
    ).rejects.toThrow(/permission denied/);
  });
  it('un evento repetido con las mismas revisiones y código no vuelve a desplegar', async () => {
    const fingerprints = [hash('9')];
    await report('200', 'succeeded', fingerprints);
    const result = await report('201', 'ready', fingerprints);
    expect(result.rows[0]).toEqual({ report_website_deployment: false });
    expect((await report('201', 'ready', fingerprints)).rows[0]).toEqual({
      report_website_deployment: false,
    });
    // Si la web cambió entre medias, el contenido anterior necesita reconstruirse.
    await report('202', 'succeeded', [hash('0')]);
    expect((await report('203', 'ready', fingerprints)).rows[0]).toEqual({
      report_website_deployment: true,
    });
  });
  it('rechaza callback si la integración del servidor ha cambiado', async () => {
    await db.query(
      "update public.restaurant_integrations set external_dataset='staging' where id=$1",
      [ib],
    );
    await expect(report('110', 'succeeded', [hash('8')], dbb)).rejects.toThrow(
      'Deployment unavailable',
    );
  });
});
