// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1),
  staff = id(2),
  other = id(3),
  suspended = id(4),
  outsider = id(5),
  admin = id(6),
  manager = id(7);
const a = id(101),
  b = id(102),
  c = id(103);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;`,
  );
  await db.exec(await readFile('supabase/migrations/202610310001_platform.sql', 'utf8'));
  await db.exec(`insert into auth.users(id) values ${[owner, staff, other, suspended, outsider, admin, manager].map((x) => `('${x}')`).join(',')};
 insert into public.restaurants(id,name,slug,status) values('${a}','A','a','active'),('${b}','B','b','active'),('${c}','C','c','suspended');
 insert into public.restaurant_memberships(restaurant_id,user_id,role) values('${a}','${owner}','restaurant_owner'),('${a}','${staff}','restaurant_staff'),('${b}','${other}','restaurant_owner'),('${a}','${suspended}','restaurant_owner'),('${c}','${owner}','restaurant_owner'),('${a}','${manager}','restaurant_manager');
 update public.profiles set status='suspended' where id='${suspended}';
 insert into app_private.platform_administrators(user_id) values('${admin}');
 insert into public.restaurant_module_entitlements(restaurant_id,module_key,granted) values('${a}','content_management',true),('${b}','content_management',true),('${c}','content_management',true);
 insert into public.restaurant_modules(restaurant_id,module_key,enabled) values('${a}','content_management',true),('${a}','analytics',false),('${b}','content_management',true),('${c}','content_management',true);
 insert into public.restaurant_integrations(restaurant_id,provider,external_project_id,external_dataset) values('${a}','sanity','testa','test'),('${b}','sanity','testb','test');`);
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function asUser<T>(user: string | null, fn: () => Promise<T>, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || '']);
    return await fn();
  } finally {
    await db.exec('rollback');
  }
}
const select = (sql: string) => db.query(sql);
describe('RLS real en PostgreSQL aislado (PGlite)', () => {
  it('A no ve B ni sus membresías', async () => {
    await asUser(owner, async () => {
      expect((await select('select id from public.restaurants')).rows).toEqual([{ id: a }]);
      expect(
        (await select('select distinct restaurant_id from public.restaurant_memberships')).rows,
      ).toEqual([{ restaurant_id: a }]);
    });
  });
  it('sin membresía no consulta datos privados', async () => {
    await asUser(outsider, async () => {
      expect((await select('select * from public.restaurants')).rows).toHaveLength(0);
      expect((await select('select * from public.restaurant_integrations')).rows).toHaveLength(0);
    });
  });
  it('anónimo no tiene privilegios de tabla ni RPC', async () => {
    await expect(
      asUser(null, () => select('select * from public.restaurants'), 'anon'),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(null, () => select(`select public.authorize_content('${a}')`), 'anon'),
    ).rejects.toThrow(/permission denied/);
  });
  it('staff no modifica roles ni accede a editor', async () => {
    await expect(
      asUser(staff, () =>
        select(
          `update public.restaurant_memberships set role='restaurant_owner' where user_id='${staff}'`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(staff, () => select(`select public.authorize_content('${a}')`)),
    ).rejects.toThrow(/Forbidden/);
  });
  it('propietario no se convierte en administrador ni altera su suspensión', async () => {
    await expect(
      asUser(owner, () =>
        select(`insert into app_private.platform_administrators(user_id) values('${owner}')`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, () => select("update public.profiles set status='active'")),
    ).rejects.toThrow(/permission denied/);
  });
  it('propietario no se concede módulos y no activa uno no contratado', async () => {
    await expect(
      asUser(owner, () =>
        select(
          `insert into public.restaurant_module_entitlements(restaurant_id,module_key,granted) values('${a}','analytics',true)`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await asUser(owner, async () => {
      expect(
        (
          await select(
            `update public.restaurant_modules set enabled=true where module_key='analytics' returning id`,
          )
        ).rows,
      ).toHaveLength(0);
    });
  });
  it('no acepta project/dataset compartido entre restaurantes ni JSON de secretos', async () => {
    await expect(
      db.query(
        "insert into public.restaurant_integrations(restaurant_id,provider,external_project_id,external_dataset) values($1,'sanity','testa','test')",
        [c],
      ),
    ).rejects.toThrow(/unique/);
    await expect(
      db.query('update public.restaurant_integrations set configuration=$1', [
        { token: 'not-allowed' },
      ]),
    ).rejects.toThrow(/check constraint/);
  });
  it('perfil suspendido pierde todo acceso editorial', async () => {
    await asUser(suspended, async () => {
      expect((await select('select * from public.profiles')).rows).toHaveLength(0);
      expect((await select('select * from public.restaurants')).rows).toHaveLength(0);
    });
    await expect(
      asUser(suspended, () => select(`select public.authorize_content('${a}')`)),
    ).rejects.toThrow(/Forbidden/);
  });
  it('restaurante suspendido no permite operaciones ordinarias', async () => {
    await asUser(owner, async () => {
      expect(
        (await select(`update public.restaurants set name='Changed' where id='${c}' returning id`))
          .rows,
      ).toHaveLength(0);
    });
    await expect(
      asUser(owner, () => select(`select public.authorize_content('${c}')`)),
    ).rejects.toThrow(/Forbidden/);
  });
  it('owner/manager autorizados solo resuelven su integración', async () => {
    for (const user of [owner, manager])
      await asUser(user, async () => {
        const r = await db.query<{ integration: { projectId: string } }>(
          `select public.authorize_content('${a}') as integration`,
        );
        expect(r.rows[0].integration.projectId).toBe('testa');
      });
    await expect(
      asUser(owner, () => select(`select public.authorize_content('${b}')`)),
    ).rejects.toThrow(/Forbidden/);
  });
  it('módulo desactivado y contratación revocada bloquean el backend', async () => {
    await db.exec('begin');
    try {
      await db.exec(
        `update public.restaurant_modules set enabled=false where restaurant_id='${a}' and module_key='content_management';set local role authenticated;select set_config('request.jwt.claim.sub','${owner}',true);`,
      );
      await expect(select(`select public.authorize_content('${a}')`)).rejects.toThrow(
        /Module unavailable/,
      );
    } finally {
      await db.exec('rollback');
    }
    await db.exec('begin');
    try {
      await db.exec(
        `update public.restaurant_module_entitlements set granted=false where restaurant_id='${a}';set local role authenticated;select set_config('request.jwt.claim.sub','${owner}',true);`,
      );
      await expect(select(`select public.authorize_content('${a}')`)).rejects.toThrow(
        /Module unavailable/,
      );
    } finally {
      await db.exec('rollback');
    }
  });
  it('owner actualiza solo columnas autorizadas; membresía suspendida se revoca', async () => {
    await asUser(owner, async () => {
      expect(
        (
          await select(
            `update public.restaurants set name='Nuevo nombre' where id='${a}' returning id`,
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await select(
            `update public.profiles set display_name='Nombre' where id='${owner}' returning id`,
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await select(
            `update public.restaurant_modules set enabled=false where restaurant_id='${a}' and module_key='content_management' returning id`,
          )
        ).rows,
      ).toHaveLength(1);
    });
    await db.exec('begin');
    try {
      await db.exec(
        `update public.restaurant_memberships set status='suspended' where user_id='${owner}' and restaurant_id='${a}';set local role authenticated;select set_config('request.jwt.claim.sub','${owner}',true);`,
      );
      expect((await select('select * from public.restaurants')).rows).toHaveLength(0);
      await expect(select(`select public.authorize_content('${a}')`)).rejects.toThrow(/Forbidden/);
    } finally {
      await db.exec('rollback');
    }
  });
  it('RPC administrativa deniega authenticated y valida actor service_role', async () => {
    await expect(
      asUser(owner, () => select(`select public.admin_configure('${owner}','restaurant','{}')`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        null,
        () => select(`select public.admin_configure('${owner}','restaurant','{}')`),
        'service_role',
      ),
    ).rejects.toThrow(/Forbidden/);
    await asUser(
      null,
      async () => {
        const r = await db.query('select public.admin_configure($1,$2,$3) as id', [
          admin,
          'restaurant',
          { name: 'New', slug: 'new', status: 'pending' },
        ]);
        expect(r.rows).toHaveLength(1);
      },
      'service_role',
    );
  });
});
