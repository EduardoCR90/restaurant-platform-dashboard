import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

// Prueba de transporte de la CLI contra localhost, sin credenciales o API Supabase reales.
const cli = process.env.SUPABASE_CLI || 'supabase';
const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'platform-edge-package-'));
const fixture = join(temporary, 'project');
const expected = {
  content: [
    'shared/publication-mutation.ts',
    'shared/publications.ts',
    'supabase/functions/_shared/publications.ts',
    'supabase/functions/content/index.ts',
    'supabase/functions/_shared/auth.ts',
    'supabase/functions/_shared/environment.ts',
    'supabase/functions/_shared/http.ts',
    'supabase/functions/_shared/sanity.ts',
    'supabase/functions/_shared/sanity-write-policy.ts',
    'supabase/functions/_shared/content-authorization.ts',
    'shared/editor-service.ts',
    'shared/editorial-state.ts',
    'shared/content.ts',
    'shared/editorial.ts',
  ],
  publications: [
    'supabase/functions/publications/index.ts',
    'supabase/functions/_shared/publications.ts',
    'supabase/functions/_shared/auth.ts',
    'supabase/functions/_shared/http.ts',
    'supabase/functions/_shared/environment.ts',
    'shared/github-oidc.ts',
    'shared/publications.ts',
  ],
  'platform-admin': [
    'supabase/functions/_shared/content-authorization.ts',
    'supabase/functions/platform-admin/index.ts',
    'supabase/functions/_shared/auth.ts',
    'supabase/functions/_shared/environment.ts',
    'supabase/functions/_shared/http.ts',
    'shared/access.ts',
    'shared/editor-service.ts',
    'shared/editorial-state.ts',
    'shared/content.ts',
    'shared/editorial.ts',
  ],
};
const uploads = new Map();
const requestErrors = [];

async function copySources(directory) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') await copySources(path);
    } else if (entry.name.endsWith('.ts') || entry.name === 'deno.json') {
      await mkdir(join(fixture, directory), { recursive: true });
      await writeFile(join(fixture, path), await readFile(join(root, path)));
    }
  }
}
function run(args) {
  return new Promise((accept, reject) => {
    const child = spawn(cli, args, {
      cwd: fixture,
      // Entorno explícito: no heredar un PAT, claves o dotenv de producción.
      env: {
        PATH: process.env.PATH,
        SUPABASE_HOME: join(temporary, 'cli-state'),
        SUPABASE_ACCESS_TOKEN: 'sbp_' + '0'.repeat(40),
        SUPABASE_TELEMETRY_DISABLED: 'true',
        DO_NOT_TRACK: '1',
        NO_PROXY: 'localhost,127.0.0.1,::1',
        no_proxy: 'localhost,127.0.0.1,::1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) accept(output);
      else reject(new Error(`CLI local (${code}): ${output.slice(-5000)}`));
    });
  });
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost:8080');
    if (request.method === 'GET' && url.pathname === '/v1/projects/aaaaaaaaaaaaaaaaaaaa') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Sin caché de proyecto en la API local' }));
      return;
    }
    // Solo se acepta el proyecto ficticio del test. Cualquier otra ruta falla cerrado.
    assert.equal(request.method, 'POST');
    assert.equal(url.pathname, '/v1/projects/aaaaaaaaaaaaaaaaaaaa/functions/deploy');
    const slug = url.searchParams.get('slug');
    assert.ok(Object.hasOwn(expected, slug));
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const incoming = new Request(url, { method: 'POST', headers: request.headers, body });
    const form = await incoming.formData();
    const metadata = JSON.parse(form.get('metadata'));
    assert.equal(metadata.name, slug);
    assert.equal(metadata.verify_jwt, false);
    assert.equal(metadata.entrypoint_path, `supabase/functions/${slug}/index.ts`);
    assert.equal(metadata.import_map_path, 'supabase/functions/deno.json');
    const files = new Map();
    for (const value of form.values())
      if (typeof value !== 'string') files.set(value.name, await value.text());
    for (const path of [...expected[slug], 'supabase/functions/deno.json']) {
      assert.equal(
        files.get(path),
        await readFile(join(root, path), 'utf8'),
        `Archivo ausente o alterado: ${path}; incluidos: ${[...files.keys()]}`,
      );
    }
    assert.ok(
      [...files.keys()].every((path) => !path.includes('node_modules') && !path.includes('.env')),
    );
    const imports = JSON.parse(files.get('supabase/functions/deno.json')).imports;
    assert.equal(imports.zod, 'npm:zod@4.6.7');
    assert.equal(imports['@supabase/supabase-js'], 'npm:@supabase/supabase-js@2.118.0');
    if (slug === 'content')
      assert.ok(
        files
          .get('supabase/functions/_shared/sanity.ts')
          .includes('assertSanityWriteTarget(target, productionTarget)'),
      );
    uploads.set(slug, { metadata, files: [...files.keys()] });
    // No se almacena ni ejecuta el código recibido; solo se valida el multipart.
    response.writeHead(201, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        id:
          slug === 'content'
            ? '00000000-0000-4000-8000-000000000001'
            : '00000000-0000-4000-8000-000000000002',
        slug,
        name: slug,
        status: 'ACTIVE',
        version: 1,
        verify_jwt: false,
        created_at: 0,
        updated_at: 0,
      }),
    );
  } catch (error) {
    requestErrors.push(error);
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({ message: error instanceof Error ? error.message : 'Invalid local package' }),
    );
  }
});
try {
  await mkdir(join(fixture, 'supabase'), { recursive: true });
  await writeFile(
    join(fixture, 'supabase/config.toml'),
    await readFile(join(root, 'supabase/config.toml')),
  );
  await copySources('supabase/functions');
  await copySources('shared');
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(8080, 'localhost', accept);
  });
  const version = (await run(['--version'])).trim();
  assert.equal(version, '2.122.0');
  for (const slug of Object.keys(expected)) {
    // supabase-local es un perfil incorporado en esta versión, URL fija http://localhost:8080.
    await run([
      'functions',
      'deploy',
      slug,
      '--project-ref',
      'aaaaaaaaaaaaaaaaaaaa',
      '--use-api',
      '--no-verify-jwt',
      '--import-map',
      'supabase/functions/deno.json',
      '--profile',
      'supabase-local',
    ]);
    assert.ok(uploads.has(slug));
    console.log(
      `OK paquete local ${slug}: verify_jwt=false, import map y ${uploads.get(slug).files.length} archivos incluidos.`,
    );
  }
  assert.deepEqual(requestErrors, []);
  assert.equal(uploads.size, 3);
  console.log(
    'Sin contacto con Supabase real, sin despliegue y sin escrituras de contenido o base de datos.',
  );
} finally {
  await new Promise((accept) => server.close(accept));
  await rm(temporary, { recursive: true, force: true });
}
