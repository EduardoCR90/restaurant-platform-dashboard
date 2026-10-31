import { test, expect, type Page } from '@playwright/test';
const project = 'wanrzgumoamryuybmopa';
const userId = '00000000-0000-4000-8000-000000000001';
const restaurantId = '00000000-0000-4000-8000-000000000101';
const b = '00000000-0000-4000-8000-000000000102';
const user = {
  id: userId,
  email: 'owner@example.test',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-31T00:00:00Z',
};
async function mockedWorkspace(page: Page) {
  const accessToken =
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') +
    '.' +
    Buffer.from(
      JSON.stringify({
        sub: userId,
        role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url') +
    '.test-signature';
  await page.addInitScript(
    ({ project, accessToken, user }) => {
      localStorage.setItem(
        `sb-${project}-auth-token`,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'isolated-test-refresh-token',
          token_type: 'bearer',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          user,
        }),
      );
    },
    { project, accessToken, user },
  );
  let snapshot = {
    id: 'page1',
    kind: 'page',
    draftRev: null as string | null,
    publishedRev: 'published-1',
    document: {
      title: 'Experiencias',
      slug: { _type: 'slug', current: 'experiencias' },
      intro: 'Contenido de ensayo',
      blocks: [],
      seo: { title: 'Experiencias', description: 'Descripción de ensayo' },
    },
  };
  await page.route(`https://${project}.supabase.co/**`, async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname.endsWith('/auth/v1/user')) body = user;
    else if (url.pathname.includes('/rest/v1/profiles'))
      body = { id: userId, display_name: 'Equipo de prueba', status: 'active' };
    else if (url.pathname.includes('/rest/v1/restaurants'))
      body = [
        { id: restaurantId, name: 'Restaurante de prueba', slug: 'test', status: 'active' },
        { id: b, name: 'Segundo restaurante', slug: 'second', status: 'active' },
      ];
    else if (url.pathname.includes('/rest/v1/restaurant_memberships'))
      body = [
        {
          restaurant_id: restaurantId,
          user_id: userId,
          role: 'restaurant_owner',
          status: 'active',
        },
        { restaurant_id: b, user_id: userId, role: 'restaurant_staff', status: 'active' },
      ];
    else if (url.pathname.includes('/rest/v1/restaurant_module_entitlements'))
      body = [{ restaurant_id: restaurantId, module_key: 'content_management', granted: true }];
    else if (url.pathname.includes('/rest/v1/restaurant_modules'))
      body = [{ restaurant_id: restaurantId, module_key: 'content_management', enabled: true }];
    else if (url.pathname.includes('/rest/v1/restaurant_integrations')) body = [];
    else if (url.pathname.includes('/rpc/is_platform_admin')) body = false;
    else if (url.pathname.includes('/functions/v1/content')) {
      const request = route.request().postDataJSON() as {
        action: string;
        kind: string;
        document?: typeof snapshot.document;
        draftRev?: string | null;
        publishedRev?: string | null;
      };
      if (request.action === 'list')
        body =
          request.kind === 'page'
            ? [{ id: 'page1', title: 'Experiencias', draft: false, published: true }]
            : [];
      if (request.action === 'get') body = snapshot;
      if (request.action === 'save') {
        expect(request.publishedRev).toBe('published-1');
        snapshot = { ...snapshot, draftRev: 'draft-1', document: request.document! };
        body = snapshot;
      }
      if (request.action === 'publish') {
        expect(request.draftRev).toBe('draft-1');
        snapshot = { ...snapshot, draftRev: null, publishedRev: 'published-2' };
        body = snapshot;
      }
    }
    await route.fulfill({ json: body });
  });
}
test('rutas privadas y recuperación en móvil, sin llamadas de escritura remotas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/content/page');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  await page.screenshot({ path: 'test-results/login-mobile.png', fullPage: true });
  await page.getByRole('link', { name: '¿Has olvidado tu contraseña?' }).click();
  await expect(page.getByRole('heading', { name: 'Volver a entrar' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('selección autorizada, edición, guardado y publicación (API de ensayo)', async ({ page }) => {
  await mockedWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hola, Equipo de prueba.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page
    .getByRole('link', { name: 'El contenido de tu web Páginas, bloques e imágenes ↗' })
    .click();
  await page.getByRole('link', { name: /^Experiencias Publicado/ }).click();
  await page.getByRole('textbox', { name: /^Título\s*\*$/ }).fill('Nueva experiencia');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Borrador guardado. Todavía no se ha publicado.',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Publicar borrador ↗' }).click();
  await expect(page.getByRole('status')).toContainText('Contenido publicado en Sanity');
  await page.getByLabel('Restaurante', { exact: true }).selectOption(b);
  await expect(
    page.getByRole('heading', { name: 'Segundo restaurante', exact: true }),
  ).toBeVisible();
  await page.goto('/content/page');
  await expect(
    page.getByRole('heading', { name: 'Este espacio no está disponible.' }),
  ).toBeVisible();
});
