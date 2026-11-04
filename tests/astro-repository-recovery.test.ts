// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const admin = '00000000-0000-4000-8000-000000000001';
const restaurant = '00ba7e95-9bd0-4df4-bd53-f76855c5e91f';
const integration = '307ff26b-57a9-498c-9ee2-b798c2f5c290';
const sanityRequest = '6fa2ef1e-5427-4e04-9876-d0413843b1ea';
const astroRequest = '7c0d6fd5-9534-4579-9062-96d3dc76eb08';
const aggregateRequest = '594ef199-3f83-4d3d-9ffd-4fcc87f2c471';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;
     create schema auth;create table auth.users(id uuid primary key,email text);
     create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
     grant usage on schema auth to authenticated;`,
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

  await db.exec(`
    insert into auth.users(id,email) values('${admin}','admin@example.test');
    insert into app_private.platform_administrators(user_id) values('${admin}');
    insert into public.template_releases(template_key,version,source_commit,distribution_hash,configuration_contract,content_contract,visual_contract)
      values('restaurant-editorial','0.4.0','${'a'.repeat(40)}','${'b'.repeat(64)}',1,'salitre-v1',2);
    insert into public.restaurants(id,name,slug,status)
      values('${restaurant}','Abre Tu Corazón','abretucorazon','pending');
    insert into public.restaurant_integrations(id,restaurant_id,provider,external_project_id,external_dataset)
      values('${integration}','${restaurant}','sanity','lvtvr3ef','production');
    insert into public.sanity_provisioning_jobs(request_id,request_hash,restaurant_id,integration_id,name,slug,project_id,external_project_id,dataset,status,stage,retryable)
      values('${sanityRequest}','${'c'.repeat(64)}','${restaurant}','${integration}','Abre Tu Corazón','abretucorazon','ra138101d442db33','lvtvr3ef','production','succeeded','completed',false);
    insert into public.astro_provisioning_jobs(request_id,request_hash,sanity_request_id,restaurant_id,integration_id,template_key,template_version,source_template_commit,distribution_hash,visual,modules,custom_domain,repository,visibility,site_url,base_path,publication_endpoint,provisioning_endpoint,status,stage,retryable,error_code,created_by)
      values('${astroRequest}','${'d'.repeat(64)}','${sanityRequest}','${restaurant}','${integration}','restaurant-editorial','0.4.0','${'a'.repeat(40)}','${'b'.repeat(64)}','{"preset":"elegant"}','[]','abretucorazon.codecanario.com','EduardoCR90/abretucorazon-restaurant','public','https://eduardocr90.github.io/abretucorazon-restaurant/','/abretucorazon-restaurant','https://platform.example/functions/v1/publications','https://platform.example/functions/v1/astro-provisioning','manual_review','queued',false,'repository_conflict','${admin}');
    insert into public.restaurant_provisioning_jobs(request_id,request_hash,name,slug,client_email,client_role,template_key,template_version,visual,modules,custom_domain,domain_mode,sanity_request_id,astro_request_id,restaurant_id,integration_id,status,stage,retryable,error_code,created_by)
      values('${aggregateRequest}','${'e'.repeat(64)}','Abre Tu Corazón','abretucorazon','client@example.test','restaurant_owner','restaurant-editorial','0.4.0','{"preset":"elegant"}','[]','abretucorazon.codecanario.com','subdomain','${sanityRequest}','${astroRequest}','${restaurant}','${integration}','manual_review','astro',false,'astro','${admin}');
  `);
}, 30_000);

afterAll(async () => db?.close());

describe('Abre Tu Corazón Astro recovery guard', () => {
  it('requires explicit confirmation and prepares an idempotent manual retry only', async () => {
    const script = await readFile(
      'ops/abre-tu-corazon-recovery/reconcile-existing-astro-repository.sql',
      'utf8',
    );
    await expect(db.exec(script)).rejects.toThrow(/confirmation missing/);

    await db.exec('begin');
    try {
      await db.exec("set local app.abre_tu_corazon_confirmation='RECONCILE-ASTRO-1444959693'");
      await db.exec(script);
      await db.exec(script);
      const child = await db.query<{
        status: string;
        stage: string;
        retryable: boolean;
        repository_id: string | null;
      }>('select status,stage,retryable,repository_id from public.astro_provisioning_jobs');
      expect(child.rows).toEqual([
        { status: 'failed', stage: 'queued', retryable: true, repository_id: null },
      ]);
      const parent = await db.query<{ status: string; stage: string; retryable: boolean }>(
        'select status,stage,retryable from public.restaurant_provisioning_jobs',
      );
      expect(parent.rows).toEqual([{ status: 'failed', stage: 'astro', retryable: true }]);
      const sanity = await db.query<{ status: string; stage: string; external_project_id: string }>(
        'select status,stage,external_project_id from public.sanity_provisioning_jobs',
      );
      expect(sanity.rows).toEqual([
        { status: 'succeeded', stage: 'completed', external_project_id: 'lvtvr3ef' },
      ]);
    } finally {
      await db.exec('rollback');
    }
  });
});
