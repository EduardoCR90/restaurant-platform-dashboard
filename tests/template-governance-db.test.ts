// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, it, expect } from 'vitest';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const a = id(1),
  b = id(2),
  owner = id(3),
  other = id(4),
  admin = id(5),
  staff = id(6),
  ia = id(7),
  ib = id(8),
  da = id(9),
  dbb = id(10);
let db: PGlite;
const release = {
  template_key: 'restaurant-editorial',
  version: '0.3.0',
  source_commit: 'a'.repeat(40),
  distribution_hash: 'b'.repeat(64),
  configuration_contract: 1,
  content_contract: 'salitre-v1',
  visual_contract: 2,
};
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
    await db.exec(await readFile('supabase/migrations/' + migration, 'utf8'));
  await db.exec(`insert into auth.users values('${owner}'),('${other}'),('${admin}'),('${staff}');
 insert into app_private.platform_administrators(user_id) values('${admin}');
 insert into public.restaurants(id,name,slug,status) values('${a}','A','a','active'),('${b}','B','b','active');
 insert into public.restaurant_memberships(restaurant_id,user_id,role) values('${a}','${owner}','restaurant_owner'),('${b}','${other}','restaurant_manager'),('${a}','${staff}','restaurant_staff');
 insert into public.restaurant_module_entitlements(restaurant_id,module_key,granted) values('${a}','content_management',true),('${b}','content_management',true);
 insert into public.restaurant_modules(restaurant_id,module_key,enabled) values('${a}','content_management',true),('${b}','content_management',true);
 insert into public.restaurant_integrations(id,restaurant_id,provider,external_project_id,external_dataset) values('${ia}','${a}','sanity','projecta','production'),('${ib}','${b}','sanity','projectb','staging');
 insert into public.website_deployments(id,restaurant_id,integration_id,project_id,dataset,repository,repository_id,site_url) values('${da}','${a}','${ia}','projecta','production','owner/a','123','https://a.example'),('${dbb}','${b}','${ib}','projectb','staging','owner/b','456','https://b.example');`);
  await db.query(
    `insert into public.template_releases select * from jsonb_populate_record(null::public.template_releases,$1)`,
    [release],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function transaction(fn: () => Promise<unknown>, user?: string, role = 'authenticated') {
  await db.exec('begin');
  try {
    if (user !== undefined) {
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    }
    return await fn();
  } finally {
    await db.exec('rollback');
  }
}
const selectTemplate = (
  actor = admin,
  restaurant = a,
  expected: number | null = null,
  version = '0.3.0',
) =>
  db.query('select public.admin_website_configure($1,$2,$3)', [
    actor,
    'select_template',
    {
      restaurant_id: restaurant,
      template_key: 'restaurant-editorial',
      version,
      expected_revision: expected,
    },
  ]);
const report = (phase: string, run = '100', target = da) =>
  db.query('select public.report_website_deployment($1,$2,1,$3,$4,$5)', [
    target,
    run,
    'c'.repeat(40),
    phase,
    [run === '100' ? 'e'.repeat(64) : 'd'.repeat(64)],
  ]);
const templateReport = (phase: string, run = '100', identity = release, target = da) =>
  db.query('select public.report_template_build($1,$2,1,$3,$4,$5)', [
    target,
    run,
    'c'.repeat(40),
    phase,
    identity,
  ]);
it.each([owner, other, staff])(
  'client cannot activate modules through REST or privileged RPC (%s)',
  async (user) => {
    await expect(
      transaction(() => db.exec('update public.restaurant_modules set enabled=false'), user),
    ).rejects.toThrow(/permission denied/);
    await expect(
      transaction(
        () =>
          db.query('select public.admin_website_configure($1,$2,$3)', [
            user,
            'module_activation',
            { restaurant_id: a, module_key: 'content_management', enabled: false },
          ]),
        '',
        'service_role',
      ),
    ).rejects.toThrow(/Forbidden/);
  },
);
it('Super Admin can activate granted modules only; values of other tenants remain unchanged', async () => {
  await transaction(
    async () => {
      await db.query('select public.admin_website_configure($1,$2,$3)', [
        admin,
        'module_activation',
        { restaurant_id: a, module_key: 'content_management', enabled: false },
      ]);
      expect(
        (
          await db.query<{ enabled: boolean }>(
            'select enabled from public.restaurant_modules where restaurant_id=$1',
            [b],
          )
        ).rows[0].enabled,
      ).toBe(true);
    },
    '',
    'service_role',
  );
  await expect(
    transaction(
      () =>
        db.query('select public.admin_website_configure($1,$2,$3)', [
          admin,
          'module_activation',
          { restaurant_id: a, module_key: 'analytics', enabled: true },
        ]),
      '',
      'service_role',
    ),
  ).rejects.toThrow(/not granted/);
});
it('authenticated and anon cannot call administrative or deployment RPCs or register versions', async () => {
  await expect(transaction(() => selectTemplate(), owner)).rejects.toThrow(/permission denied/);
  await expect(transaction(() => templateReport('ready'), owner)).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    transaction(() => db.exec('select * from public.restaurant_websites'), '', 'anon'),
  ).rejects.toThrow(/permission denied/);
  await expect(
    transaction(
      () => db.exec("update public.template_releases set version='9.0.0'"),
      '',
      'service_role',
    ),
  ).rejects.toThrow(/permission denied/);
});
it('selection is optimistic and does not claim installation or change the deployment', async () => {
  await transaction(async () => {
    await selectTemplate();
    const row = (
      await db.query<{ installed_version: null; desired_version: string; revision: number }>(
        'select * from public.restaurant_websites where restaurant_id=$1',
        [a],
      )
    ).rows[0];
    expect(row).toMatchObject({ installed_version: null, desired_version: '0.3.0', revision: 0 });
    await expect(selectTemplate(admin, a, null)).rejects.toThrow(/revision conflict/);
  });
  await expect(transaction(() => selectTemplate(admin, a, null, '9.0.0'))).rejects.toThrow(
    /not approved/,
  );
});
it('versions are tenant-isolated; staff and unassigned customers cannot read another site', async () => {
  await db.query(
    'insert into public.restaurant_websites(restaurant_id) values($1),($2) on conflict do nothing',
    [a, b],
  );
  await transaction(
    async () =>
      expect((await db.query('select restaurant_id from public.restaurant_websites')).rows).toEqual(
        [{ restaurant_id: a }],
      ),
    owner,
  );
  await transaction(
    async () =>
      expect((await db.query('select restaurant_id from public.restaurant_websites')).rows).toEqual(
        [{ restaurant_id: b }],
      ),
    other,
  );
  await transaction(
    async () =>
      expect((await db.query('select restaurant_id from public.restaurant_websites')).rows).toEqual(
        [],
      ),
    staff,
  );
});
it('failed, premature and mismatched reports cannot install a version', async () => {
  await expect(transaction(() => templateReport('succeeded'))).rejects.toThrow(/No validated/);
  await transaction(async () => {
    await report('ready');
    await templateReport('ready');
    await report('failed');
    await expect(templateReport('succeeded')).rejects.toThrow(/No validated/);
  });
  await transaction(async () => {
    await report('ready');
    await expect(
      templateReport('ready', '100', { ...release, source_commit: 'f'.repeat(40) }),
    ).rejects.toThrow(/Unapproved/);
  });
  await transaction(async () => {
    await report('succeeded');
    await expect(templateReport('succeeded')).rejects.toThrow(/No matching/);
  });
});
it('only the same successful build records installed identity; replays and older runs cannot overwrite it', async () => {
  await transaction(async () => {
    await report('ready', '200');
    await templateReport('ready', '200');
    expect(
      (
        await db.query<{ installed_version: null }>(
          'select installed_version from public.restaurant_websites where restaurant_id=$1',
          [a],
        )
      ).rows[0]?.installed_version ?? null,
    ).toBeNull();
    await report('succeeded', '200');
    await templateReport('succeeded', '200');
    const first = (
      await db.query(
        'select installed_version,verified_run_id,revision from public.restaurant_websites where restaurant_id=$1',
        [a],
      )
    ).rows[0];
    expect(first).toMatchObject({ installed_version: '0.3.0', verified_run_id: '200' });
    await templateReport('succeeded', '200');
    await report('ready', '100');
    await templateReport('ready', '100');
    await report('succeeded', '100');
    await templateReport('succeeded', '100');
    expect(
      (
        await db.query(
          'select installed_version,verified_run_id,revision from public.restaurant_websites where restaurant_id=$1',
          [a],
        )
      ).rows[0],
    ).toEqual(first);
  });
});
it('cross-tenant deployment association and suspended Super Admin are rejected', async () => {
  await expect(
    transaction(() =>
      db.query('update public.restaurant_websites set deployment_id=$1 where restaurant_id=$2', [
        da,
        b,
      ]),
    ),
  ).rejects.toThrow(/foreign key/);
  await transaction(async () => {
    await db.query("update public.profiles set status='suspended' where id=$1", [admin]);
    await expect(selectTemplate()).rejects.toThrow(/Forbidden/);
  });
});
