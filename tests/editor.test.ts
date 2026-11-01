// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  executeContent,
  HttpError,
  validateUpload,
  type ContentStore,
  type SanityDocument,
} from '../shared/editor-service';
import { validateContent, blockNames } from '../shared/content';
const restaurantId = '00000000-0000-4000-8000-000000000001';
const page = {
  title: 'Una página',
  slug: { _type: 'slug', current: 'experiencias' },
  seo: { title: 'Experiencias', description: 'Una descripción' },
  blocks: [],
};
function fakeStore() {
  const docs = new Map<string, SanityDocument>();
  let n = 0;
  const mutate = vi.fn<ContentStore['mutate']>(async (mutations) => {
    const copy = new Map(docs);
    const results: { id: string; document?: SanityDocument }[] = [];
    for (const mutation of mutations) {
      if (mutation.create) {
        const d = mutation.create as Record<string, unknown>;
        const id = d._id === 'drafts.' ? 'drafts.generated-by-sanity' : String(d._id);
        if (copy.has(id)) throw new HttpError(409, 'Colisión');
        const document = {
          ...d,
          _id: id,
          _type: String(d._type),
          _rev: `rev${++n}`,
        } as SanityDocument;
        copy.set(id, document);
        results.push({ id, document });
      }
      if (mutation.patch) {
        const patch = mutation.patch as {
          id: string;
          ifRevisionID: string;
          set: Record<string, unknown>;
          unset?: string[];
        };
        const prev = copy.get(patch.id);
        if (!prev || prev._rev !== patch.ifRevisionID) throw new HttpError(409, 'Conflicto');
        const next: SanityDocument = { ...prev, ...patch.set, _rev: `rev${++n}` };
        patch.unset?.forEach((k) => delete next[k]);
        copy.set(patch.id, next);
        results.push({ id: patch.id });
      }
      if (mutation.delete) {
        const d = mutation.delete as { id: string };
        copy.delete(d.id);
        results.push({ id: d.id });
      }
    }
    docs.clear();
    copy.forEach((v, k) => docs.set(k, v));
    return { results };
  });
  const store: ContentStore = {
    query: async <T>(query: string, params: Record<string, unknown>) => {
      let result: unknown = [];
      if (query.startsWith('*[_id in [$id,$draft]]'))
        result = [...docs.values()].filter((d) => d._id === params.id || d._id === params.draft);
      else if (params.linkTypes)
        result = [...docs.values()].filter(
          (d) =>
            (params.linkTypes as string[]).includes(d._type) &&
            d._id !== params.id &&
            !d._id.startsWith('drafts.') &&
            !d._id.startsWith('versions.'),
        );
      else if (params.linkSlugs)
        result = [...docs.values()].filter(
          (d) =>
            d._type === 'page' &&
            d.status === 'hidden' &&
            (params.linkSlugs as string[]).includes((d.slug as { current: string })?.current) &&
            d._id !== params.id &&
            !d._id.startsWith('drafts.'),
        );
      else if (query.includes('slug.current'))
        result = [...docs.values()].filter(
          (d) =>
            (d.slug as { current: string })?.current === params.slug &&
            d._id !== params.id &&
            d._id !== params.draft,
        );
      else if (query.includes('_id in $ids'))
        result = [...docs.values()].filter((d) => (params.ids as string[]).includes(d._id));
      else result = [...docs.values()].filter((d) => d._type === params.kind);
      return result as T;
    },
    mutate,
    upload: vi.fn(async () => ({
      _id: 'image-safe-100x100-jpg',
      url: 'https://cdn.sanity.io/images/test/test/safe.jpg',
    })),
  };
  return {
    store,
    docs,
    mutate,
    deps: { authorize: vi.fn(async () => store), canManageDesign: vi.fn(async () => true) },
  };
}
describe('Edición Sanity (API sustituida; nunca producción)', () => {
  it('listado y lectura resuelven borrador/publicado', async () => {
    const f = fakeStore();
    f.docs.set('p', { ...page, _id: 'p', _rev: 'pub', _type: 'page' });
    f.docs.set('drafts.p', {
      ...page,
      title: 'Edición',
      _id: 'drafts.p',
      _rev: 'draft',
      _type: 'page',
    });
    expect(await executeContent({ restaurantId, action: 'list', kind: 'page' }, f.deps)).toEqual([
      { id: 'p', title: 'Edición', draft: true, published: true, withdrawn: false },
    ]);
    const r = await executeContent({ restaurantId, action: 'get', kind: 'page', id: 'p' }, f.deps);
    expect(r).toMatchObject({
      draftRev: 'draft',
      publishedRev: 'pub',
      document: { title: 'Edición' },
    });
  });
  it('creación pide ID a Sanity y no publica', async () => {
    const f = fakeStore();
    const result = await executeContent(
      { restaurantId, action: 'create', kind: 'page', document: page },
      f.deps,
    );
    expect(result).toMatchObject({ id: 'generated-by-sanity', publishedRev: null });
    expect(f.docs.has('generated-by-sanity')).toBe(false);
    expect(f.mutate.mock.calls[0][0][0]).toMatchObject({ create: { _id: 'drafts.' } });
  });
  it('guarda borrador conservando campos ajenos al formulario', async () => {
    const f = fakeStore();
    f.docs.set('p', { ...page, _id: 'p', _type: 'page', _rev: 'pub', legacy: 'preserve' });
    await executeContent(
      {
        restaurantId,
        action: 'save',
        kind: 'page',
        id: 'p',
        publishedRev: 'pub',
        draftRev: null,
        document: { ...page, title: 'Nuevo' },
      },
      f.deps,
    );
    expect(f.docs.get('p')?.title).toBe('Una página');
    expect(f.docs.get('drafts.p')).toMatchObject({ title: 'Nuevo', legacy: 'preserve' });
  });
  it('publica en transacción con ambas revisiones y solo elimina borrador', async () => {
    const f = fakeStore();
    f.docs.set('p', { ...page, _id: 'p', _type: 'page', _rev: 'pub' });
    f.docs.set('drafts.p', {
      ...page,
      title: 'Nuevo',
      _id: 'drafts.p',
      _type: 'page',
      _rev: 'draft',
    });
    await executeContent(
      {
        restaurantId,
        action: 'publish',
        kind: 'page',
        id: 'p',
        publishedRev: 'pub',
        draftRev: 'draft',
      },
      f.deps,
    );
    expect(f.docs.get('p')?.title).toBe('Nuevo');
    expect(
      f.mutate.mock.calls[0][0].every(
        (m) => !m.patch || !('_type' in (m.patch as { set: Record<string, unknown> }).set),
      ),
    ).toBe(true);
    expect(f.docs.has('drafts.p')).toBe(false);
    expect(f.mutate.mock.calls[0][0]).toMatchObject([
      { patch: { ifRevisionID: 'draft' } },
      { patch: { ifRevisionID: 'pub' } },
      { delete: { id: 'drafts.p' } },
    ]);
  });
  it('revision stale bloquea cambios, sin reintento', async () => {
    const f = fakeStore();
    f.docs.set('p', { ...page, _id: 'p', _type: 'page', _rev: 'new' });
    await expect(
      executeContent(
        {
          restaurantId,
          action: 'save',
          kind: 'page',
          id: 'p',
          publishedRev: 'old',
          draftRev: null,
          document: page,
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it('rechaza slug duplicado, precio inválido y referencia categoría ausente', async () => {
    const f = fakeStore();
    f.docs.set('other', { ...page, _id: 'other', _type: 'page', _rev: 'v' });
    await expect(
      executeContent({ restaurantId, action: 'create', kind: 'page', document: page }, f.deps),
    ).rejects.toMatchObject({ status: 409 });
    expect(() => validateContent('dish', { price: -1 })).toThrow();
    await expect(
      executeContent(
        {
          restaurantId,
          action: 'create',
          kind: 'dish',
          document: {
            name: 'Plato',
            description: 'Texto',
            price: 12,
            category: { _type: 'reference', _ref: 'missing' },
            allergens: [],
            available: true,
            featured: false,
            order: 0,
          },
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('categorías y platos válidos se guardan con IDs referenciados reales', async () => {
    const f = fakeStore();
    f.docs.set('cat', { _id: 'cat', _type: 'category', _rev: 'v', name: 'Entrantes' });
    const document = {
      name: 'Plato',
      description: 'Texto',
      price: 12.5,
      category: { _type: 'reference', _ref: 'cat' },
      allergens: [],
      available: true,
      featured: false,
      order: 2,
    };
    await executeContent({ restaurantId, action: 'create', kind: 'dish', document }, f.deps);
    expect(f.docs.get('drafts.generated-by-sanity')?.category).toEqual({
      _type: 'reference',
      _ref: 'cat',
    });
  });
  it('autorización del backend precede lectura/escritura/imagen; errores no producen writes', async () => {
    const f = fakeStore();
    const deps = {
      authorize: vi.fn(async () => {
        throw new HttpError(403, 'Forbidden');
      }),
    };
    for (const req of [
      { action: 'list', kind: 'page' },
      { action: 'create', kind: 'page', document: page },
      { action: 'upload', mime: 'image/png', data: 'AAAA' },
    ])
      await expect(executeContent({ restaurantId, ...req }, deps)).rejects.toMatchObject({
        status: 403,
      });
    expect(deps.authorize).toHaveBeenCalledWith(restaurantId);
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it('ID solicitado no permite acceso a singleton distinto o documento con otro tipo', async () => {
    const f = fakeStore();
    f.docs.set('p', { _id: 'p', _rev: 'a', _type: 'dish' });
    await expect(
      executeContent({ restaurantId, action: 'get', kind: 'page', id: 'p' }, f.deps),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      executeContent({ restaurantId, action: 'get', kind: 'settings', id: 'other' }, f.deps),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('API caída no se oculta ni se reintenta', async () => {
    const f = fakeStore();
    f.store.query = vi.fn(async () => {
      throw new HttpError(502, 'Unavailable');
    });
    await expect(
      executeContent({ restaurantId, action: 'list', kind: 'page' }, f.deps),
    ).rejects.toMatchObject({ status: 502 });
    expect(f.store.query).toHaveBeenCalledTimes(1);
  });
  it('valida bytes de imágenes y rechaza SVG/MIME falso/tamaño excesivo', () => {
    expect(validateUpload(btoa(String.fromCharCode(255, 216, 255, 0)), 'image/jpeg').length).toBe(
      4,
    );
    expect(() => validateUpload(btoa('<svg/>'), 'image/jpeg')).toThrow();
    expect(() => validateUpload(btoa('<svg/>'), 'image/svg+xml')).toThrow();
    expect(() => validateUpload(btoa('x'.repeat(8 * 1024 * 1024 + 1)), 'image/jpeg')).toThrow(
      /8 MiB/,
    );
  });
  it('conserva los diez tipos de fase 1 y rechaza bloques desconocidos/claves duplicadas', () => {
    expect(blockNames).toHaveLength(10);
    const block = { _type: 'notice', _key: 'a', text: 'Aviso' };
    expect(() => validateContent('page', { ...page, blocks: [block, block] })).toThrow(
      /duplicadas/,
    );
    expect(() =>
      validateContent('page', { ...page, blocks: [{ _type: 'unknown', _key: 'x' }] }),
    ).toThrow();
  });
});

it('los nuevos campos editoriales completan save/publish sin tocar la publicación al guardar', async () => {
  const fixture = JSON.parse(
    await (
      await import('node:fs/promises')
    ).readFile(new URL('./fixtures/editorial-contract.json', import.meta.url), 'utf8'),
  );
  const f = fakeStore();
  f.docs.set('p', {
    ...page,
    _id: 'p',
    _rev: 'published-original',
    _type: 'page',
    unknownExisting: 'preservado',
  });
  const document = { ...page, composition: fixture.page.composition };
  const saved = (await executeContent(
    {
      restaurantId,
      action: 'save',
      kind: 'page',
      id: 'p',
      publishedRev: 'published-original',
      draftRev: null,
      document,
    },
    f.deps,
  )) as { draftRev: string; publishedRev: string };
  expect(f.docs.get('p')?.composition).toBeUndefined();
  expect(f.docs.get('drafts.p')?.composition).toEqual(document.composition);
  expect(f.docs.get('drafts.p')?.unknownExisting).toBe('preservado');
  await executeContent(
    {
      restaurantId,
      action: 'publish',
      kind: 'page',
      id: 'p',
      publishedRev: saved.publishedRev,
      draftRev: saved.draftRev,
    },
    f.deps,
  );
  expect(f.docs.get('p')?.composition).toEqual(document.composition);
  expect(f.docs.get('p')?.unknownExisting).toBe('preservado');
  expect(f.docs.has('drafts.p')).toBe(false);
});

it('SEO social y textos globales pasan por el mismo control de referencias y borradores', async () => {
  const f = fakeStore();
  const asset = 'image-offline-1600x1100-jpg';
  f.docs.set(asset, { _id: asset, _type: 'sanity.imageAsset', _rev: 'image-fixture' });
  const settings = {
    name: 'Restaurante de ensayo',
    tagline: 'Cocina',
    concept: 'Concepto',
    address: 'Dirección de ensayo',
    email: 'test@example.test',
    phone: '+34922000000',
    isFictional: true,
    hours: [{ _key: 'hours1', days: 'Lunes', time: '13:00–16:00' }],
    modules: [{ key: 'reservations', enabled: false }],
  };
  f.docs.set('restaurant-settings', {
    ...settings,
    _id: 'restaurant-settings',
    _type: 'settings',
    _rev: 'settings-original',
  });
  const document = {
    ...settings,
    editorial: { signature: 'Otra firma', footer: { link: null } },
    socialImage: {
      _type: 'editorialImage',
      asset: { _type: 'reference', _ref: asset },
      alt: 'Imagen social del ensayo',
    },
  };
  await executeContent(
    {
      restaurantId,
      action: 'save',
      kind: 'settings',
      id: 'restaurant-settings',
      publishedRev: 'settings-original',
      draftRev: null,
      document,
    },
    f.deps,
  );
  expect(f.docs.get('drafts.restaurant-settings')?.socialImage).toEqual(document.socialImage);
  expect(f.docs.get('drafts.restaurant-settings')?.editorial).toEqual(document.editorial);
  expect(f.docs.get('drafts.restaurant-settings')?.modules).toEqual(settings.modules);
  expect(f.docs.get('restaurant-settings')?.socialImage).toBeUndefined();
});

describe('Iteración 3: acciones editoriales sin borrado de publicaciones', () => {
  const base = {
    restaurantId,
    kind: 'page',
    id: 'p',
    publishedRev: 'pub',
    draftRev: 'draft',
  } as const;
  function publishedDraft() {
    const f = fakeStore();
    f.docs.set('p', { ...page, _id: 'p', _type: 'page', _rev: 'pub' });
    f.docs.set('drafts.p', {
      ...page,
      title: 'Cambio pendiente',
      _id: 'drafts.p',
      _type: 'page',
      _rev: 'draft',
    });
    return f;
  }
  function menu() {
    const f = fakeStore();
    f.docs.set('cat', {
      _id: 'cat',
      _type: 'category',
      _rev: 'category',
      name: 'Categoría',
      order: 0,
      visible: true,
    });
    f.docs.set('image-fixture', {
      _id: 'image-fixture',
      _type: 'sanity.imageAsset',
      _rev: 'asset',
    });
    f.docs.set('dish', {
      _id: 'dish',
      _type: 'dish',
      _rev: 'dish',
      name: 'Plato',
      description: 'Descripción',
      price: 18,
      category: { _type: 'reference', _ref: 'cat' },
      allergens: [],
      available: true,
      featured: false,
      order: 0,
      image: {
        _type: 'editorialImage',
        asset: { _type: 'reference', _ref: 'image-fixture' },
        alt: 'Imagen de ensayo',
      },
    });
    return f;
  }
  it('descarta únicamente el draft y recupera publicación sin modificar su revisión', async () => {
    const f = publishedDraft();
    const result = (await executeContent({ ...base, action: 'discard' }, f.deps)) as {
      discarded: boolean;
      snapshot: { draftRev: null; document: { title: string } };
    };
    expect(result.discarded).toBe(true);
    expect(result.snapshot.draftRev).toBeNull();
    expect(result.snapshot.document.title).toBe(page.title);
    expect(f.docs.get('p')?._rev).toBe('pub');
    expect(f.docs.has('drafts.p')).toBe(false);
    expect(f.mutate.mock.calls[0][0]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ patch: expect.objectContaining({ id: 'p' }) }),
      ]),
    );
  });
  it('descarta un documento nunca publicado y devuelve snapshot null sin tocar otros documentos', async () => {
    const f = publishedDraft();
    f.docs.delete('p');
    const result = await executeContent({ ...base, action: 'discard', publishedRev: null }, f.deps);
    expect(result).toEqual({ discarded: true, id: 'p', kind: 'page', snapshot: null });
    expect(f.docs.size).toBe(0);
  });
  it.each([{ publishedRev: 'stale' }, { draftRev: 'stale' }])(
    'conflicto de descarte conserva el borrador %j',
    async (change) => {
      const f = publishedDraft();
      await expect(
        executeContent({ ...base, ...change, action: 'discard' }, f.deps),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.mutate).not.toHaveBeenCalled();
      expect(f.docs.has('drafts.p')).toBe(true);
    },
  );
  it('retira y recupera un plato conservando categoría, imagen y contenido', async () => {
    const f = menu();
    const before = structuredClone(f.docs.get('dish')!);
    const result = (await executeContent(
      {
        restaurantId,
        kind: 'dish',
        id: 'dish',
        action: 'withdraw',
        publishedRev: 'dish',
        draftRev: null,
      },
      f.deps,
    )) as { withdrawn: boolean; publishedRev: string };
    expect(result.withdrawn).toBe(true);
    expect(f.docs.get('dish')).toMatchObject({
      ...before,
      _rev: expect.any(String),
      visible: false,
    });
    await executeContent(
      {
        restaurantId,
        kind: 'dish',
        id: 'dish',
        action: 'restore',
        publishedRev: result.publishedRev,
        draftRev: null,
      },
      f.deps,
    );
    expect(f.docs.get('dish')).toMatchObject({
      visible: true,
      category: before.category,
      image: before.image,
    });
    expect(f.docs.get('image-fixture')?._rev).toBe('asset');
    expect(f.docs.size).toBe(3);
  });
  it('categoría retirada conserva platos y referencias; la recuperación no modifica los platos', async () => {
    const f = menu();
    const dish = structuredClone(f.docs.get('dish'));
    const result = (await executeContent(
      {
        restaurantId,
        kind: 'category',
        id: 'cat',
        action: 'withdraw',
        publishedRev: 'category',
        draftRev: null,
      },
      f.deps,
    )) as { publishedRev: string };
    expect(f.docs.get('dish')).toEqual(dish);
    expect(f.docs.get('cat')?.visible).toBe(false);
    await executeContent(
      {
        restaurantId,
        kind: 'category',
        id: 'cat',
        action: 'restore',
        publishedRev: result.publishedRev,
        draftRev: null,
      },
      f.deps,
    );
    expect(f.docs.get('dish')).toEqual(dish);
    expect(f.docs.get('cat')?.visible).toBe(true);
  });
  it('retira y recupera páginas normales con status, sin borrar su ruta del CMS', async () => {
    const f = publishedDraft();
    f.docs.delete('drafts.p');
    const result = (await executeContent(
      { ...base, action: 'withdraw', draftRev: null },
      f.deps,
    )) as { publishedRev: string };
    expect(f.docs.get('p')?.status).toBe('hidden');
    await executeContent(
      { ...base, action: 'restore', draftRev: null, publishedRev: result.publishedRev },
      f.deps,
    );
    expect(f.docs.get('p')?.status).toBe('published');
    expect(f.docs.get('p')?.slug).toEqual(page.slug);
  });
  it.each([
    ['settings', 'restaurant-settings'],
    ['story', 'restaurant-story'],
    ['gallery', 'restaurant-gallery'],
    ['page', 'p'],
  ])('protege documento estructural %s', async (kind, id) => {
    const f = fakeStore();
    f.docs.set(id, { ...page, slug: { current: 'inicio' }, _id: id, _type: kind, _rev: 'pub' });
    await expect(
      executeContent(
        { restaurantId, kind, id, action: 'withdraw', publishedRev: 'pub', draftRev: null },
        f.deps,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it('no retira una publicación con draft pendiente ni descarta implícitamente ese draft', async () => {
    const f = publishedDraft();
    await expect(executeContent({ ...base, action: 'withdraw' }, f.deps)).rejects.toMatchObject({
      status: 409,
    });
    expect(f.docs.get('drafts.p')?.title).toBe('Cambio pendiente');
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it('recuperar un retirado con borrador publica ese borrador y solo elimina el draft', async () => {
    const f = publishedDraft();
    f.docs.set('p', { ...f.docs.get('p')!, status: 'hidden' });
    f.docs.set('drafts.p', { ...f.docs.get('drafts.p')!, status: 'hidden' });
    const result = (await executeContent({ ...base, action: 'restore' }, f.deps)) as {
      withdrawn: boolean;
    };
    expect(result.withdrawn).toBe(false);
    expect(f.docs.get('p')?.title).toBe('Cambio pendiente');
    expect(f.docs.get('p')?.status).toBe('published');
    expect(f.docs.has('drafts.p')).toBe(false);
  });
  it.each(['withdraw', 'restore'])('revision stale bloquea %s sin mutaciones', async (action) => {
    const f = publishedDraft();
    await expect(
      executeContent({ ...base, action, publishedRev: 'outdated' }, f.deps),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it('enlaces explícitos desde páginas o settings impiden retirar una ruta referenciada', async () => {
    for (const source of [
      {
        _type: 'page',
        blocks: [
          { _type: 'richText', body: [{ markDefs: [{ href: '/experiencias/?x=1#programa' }] }] },
        ],
      },
      { _type: 'settings', editorial: { footer: { link: { href: '/%65xperiencias/' } } } },
      {
        _type: 'settings',
        editorial: {
          footer: {
            link: {
              href: 'https://eduardocr90.github.io/restaurant-premium-sanity/experiencias/',
            },
          },
        },
      },
    ]) {
      const f = publishedDraft();
      f.docs.delete('drafts.p');
      f.docs.set('source', { ...source, _id: 'source', _rev: 'source' });
      await expect(
        executeContent({ ...base, action: 'withdraw', draftRev: null }, f.deps),
      ).rejects.toMatchObject({ status: 422 });
      expect(f.mutate).not.toHaveBeenCalled();
    }
  });
  it('no publica enlaces a una página retirada aunque se hayan guardado antes como borrador', async () => {
    const f = publishedDraft();
    f.docs.set('hidden', {
      ...page,
      _id: 'hidden',
      _type: 'page',
      _rev: 'hidden',
      slug: { current: 'retirada' },
      status: 'hidden',
    });
    f.docs.set('drafts.p', {
      ...f.docs.get('drafts.p')!,
      blocks: [
        { _type: 'hero', _key: 'hero', title: 'Título', cta: { label: 'Ver', href: '/retirada/' } },
      ],
    });
    await expect(executeContent({ ...base, action: 'publish' }, f.deps)).rejects.toMatchObject({
      status: 422,
    });
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it.each(['discard', 'withdraw', 'restore'])(
    'autorización y tenant preceden toda operación %s',
    async (action) => {
      const f = publishedDraft();
      const authorize = vi.fn(async () => {
        throw new HttpError(403, 'Sin membresía editorial');
      });
      await expect(
        executeContent(
          { ...base, action, projectId: 'hfa8zkyw', dataset: 'production' },
          { authorize },
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(authorize).toHaveBeenCalledWith(restaurantId);
      expect(f.mutate).not.toHaveBeenCalled();
    },
  );
  it('los listados identifican retirados sin confundir drafts nuevos con publicados', async () => {
    const f = publishedDraft();
    f.docs.set('p', { ...f.docs.get('p')!, status: 'hidden' });
    const list = (await executeContent({ restaurantId, action: 'list', kind: 'page' }, f.deps)) as {
      withdrawn: boolean;
      draft: boolean;
      published: boolean;
    }[];
    expect(list[0]).toMatchObject({ withdrawn: true, draft: true, published: true });
    f.docs.delete('p');
    const drafts = (await executeContent(
      { restaurantId, action: 'list', kind: 'page' },
      f.deps,
    )) as { withdrawn: boolean; published: boolean }[];
    expect(drafts[0]).toMatchObject({ withdrawn: false, published: false });
  });
});

it.each(['publish', 'restore'])(
  'conserva las cuatro rutas lógicas al %s, incluso con borradores antiguos',
  async (action) => {
    const f = fakeStore();
    f.docs.set('p', {
      ...page,
      slug: { current: 'carta' },
      status: action === 'restore' ? 'hidden' : 'published',
      _id: 'p',
      _type: 'page',
      _rev: 'pub',
    });
    f.docs.set('drafts.p', {
      ...page,
      slug: { current: 'otra-carta' },
      _id: 'drafts.p',
      _type: 'page',
      _rev: 'draft',
    });
    await expect(
      executeContent(
        { restaurantId, action, kind: 'page', id: 'p', publishedRev: 'pub', draftRev: 'draft' },
        f.deps,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(f.mutate).not.toHaveBeenCalled();
  },
);

describe('temas y composición: contrato visual 2', () => {
  const settings = {
    name: 'Ejemplo',
    tagline: 'Firma',
    concept: 'Concepto',
    address: 'Dirección',
    email: 'hello@example.test',
    phone: '000',
    isFictional: true,
    hours: [{ _key: 'hours', days: 'Lunes', time: '12:00' }],
  };
  it('guarda/publica presets sin llenar defaults y preserva extensiones existentes del servidor', async () => {
    const f = fakeStore();
    f.docs.set('restaurant-settings', {
      ...settings,
      _id: 'restaurant-settings',
      _type: 'settings',
      _rev: 'p',
      theme: { name: 'salitre', paper: '#123456', futureNote: 'preserve' },
    });
    const result = (await executeContent(
      {
        action: 'save',
        restaurantId,
        kind: 'settings',
        id: 'restaurant-settings',
        draftRev: null,
        publishedRev: 'p',
        visualContractVersion: 2,
        document: { ...settings, theme: { preset: 'modern', injected: 'drop' } },
      },
      f.deps,
    )) as { draftRev: string; visualContractVersion: number };
    expect(result.visualContractVersion).toBe(2);
    expect(f.docs.get('drafts.restaurant-settings')?.theme).toEqual({
      preset: 'modern',
      futureNote: 'preserve',
    });
    await executeContent(
      {
        action: 'publish',
        restaurantId,
        kind: 'settings',
        id: 'restaurant-settings',
        draftRev: result.draftRev,
        publishedRev: 'p',
      },
      f.deps,
    );
    expect(f.docs.get('restaurant-settings')?.theme).toEqual({
      preset: 'modern',
      futureNote: 'preserve',
    });
  });
  it('no permite a un cliente antiguo borrar ajustes que no conoce', async () => {
    const f = fakeStore();
    f.docs.set('restaurant-settings', {
      ...settings,
      _id: 'restaurant-settings',
      _type: 'settings',
      _rev: 'p',
      theme: { preset: 'casual' },
    });
    await expect(
      executeContent(
        {
          action: 'save',
          restaurantId,
          kind: 'settings',
          id: 'restaurant-settings',
          draftRev: null,
          publishedRev: 'p',
          document: settings,
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it('bloques y flags de sección conservan orden, referencias y disponibilidad al publicar', async () => {
    const f = fakeStore();
    f.docs.set('p', { ...page, _id: 'p', _type: 'page', _rev: 'p' });
    const blocks = [
      { _type: 'hero', _key: 'a', title: 'Hero', variant: 'split', enabled: false },
      { _type: 'divider', _key: 'b', enabled: true },
    ];
    const document = { ...page, blocks, composition: { sections: { featured: false } } };
    const result = (await executeContent(
      {
        action: 'save',
        restaurantId,
        kind: 'page',
        id: 'p',
        draftRev: null,
        publishedRev: 'p',
        visualContractVersion: 2,
        document,
      },
      f.deps,
    )) as { draftRev: string };
    await executeContent(
      {
        action: 'publish',
        restaurantId,
        kind: 'page',
        id: 'p',
        draftRev: result.draftRev,
        publishedRev: 'p',
      },
      f.deps,
    );
    expect(f.docs.get('p')?.blocks).toEqual(blocks);
    expect(f.docs.get('p')?.composition).toEqual(document.composition);
  });
  it('sin permisos editoriales un preset no concede autoridad para guardar', async () => {
    const f = fakeStore();
    f.deps.authorize.mockRejectedValue(new HttpError(403, 'Denied'));
    await expect(
      executeContent(
        {
          action: 'save',
          restaurantId,
          kind: 'settings',
          id: 'restaurant-settings',
          draftRev: null,
          publishedRev: null,
          visualContractVersion: 2,
          document: { ...settings, theme: { preset: 'casual' } },
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it.each([
    { preset: 'bad' },
    { paper: 'red;display:none' },
    { contentMax: 1 },
    { hero: '<script>' },
  ])('rechaza ajustes no seguros %j antes de escribir', async (theme) => {
    const f = fakeStore();
    f.docs.set('restaurant-settings', {
      ...settings,
      _id: 'restaurant-settings',
      _type: 'settings',
      _rev: 'p',
    });
    await expect(
      executeContent(
        {
          action: 'save',
          restaurantId,
          kind: 'settings',
          id: 'restaurant-settings',
          draftRev: null,
          publishedRev: 'p',
          visualContractVersion: 2,
          document: { ...settings, theme },
        },
        f.deps,
      ),
    ).rejects.toThrow();
    expect(f.mutate).not.toHaveBeenCalled();
  });
});

describe('Final SaaS editorial/design authorization (no remote writes)', () => {
  const blocks = [
    { _key: 'a', _type: 'hero', title: 'Editorial', variant: 'split', alignment: 'left' },
    { _key: 'b', _type: 'divider', spacing: 'large', line: true },
  ];
  function clientFixture() {
    const f = fakeStore();
    f.deps.canManageDesign.mockResolvedValue(false);
    f.docs.set('p', {
      ...page,
      blocks: structuredClone(blocks),
      _id: 'p',
      _type: 'page',
      _rev: 'pub',
    });
    return f;
  }
  const save = (document: Record<string, unknown>) => ({
    restaurantId,
    action: 'save',
    visualContractVersion: 2,
    kind: 'page',
    id: 'p',
    publishedRev: 'pub',
    draftRev: null,
    document,
  });
  it('client can change text, order and visibility without changing layouts', async () => {
    const f = clientFixture();
    await executeContent(
      save({
        ...page,
        title: 'Client text',
        blocks: [
          { ...blocks[1], enabled: false },
          { ...blocks[0], title: 'New content' },
        ],
      }),
      f.deps,
    );
    expect(f.mutate).toHaveBeenCalledOnce();
    const draft = f.docs.get('drafts.p')!;
    await executeContent(
      {
        restaurantId,
        action: 'publish',
        kind: 'page',
        id: 'p',
        publishedRev: 'pub',
        draftRev: draft._rev,
      },
      f.deps,
    );
    expect(f.docs.get('p')?.title).toBe('Client text');
  });
  it.each(['variant', 'alignment', 'position', 'width', 'spacing', 'line'])(
    'client cannot forge visual field %s',
    async (field) => {
      const f = clientFixture();
      await expect(
        executeContent(
          save({
            ...page,
            blocks: [{ ...blocks[0], [field]: field === 'line' ? false : 'compact' }, blocks[1]],
          }),
          f.deps,
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(f.mutate).not.toHaveBeenCalled();
    },
  );
  it.each(['remove', 'insert', 'type'])(
    'client cannot change block structure: %s',
    async (action) => {
      const f = clientFixture();
      const next =
        action === 'remove'
          ? []
          : action === 'insert'
            ? [...blocks, { _key: 'c', _type: 'divider' }]
            : [{ ...blocks[0], _type: 'cta' }, blocks[1]];
      await expect(executeContent(save({ ...page, blocks: next }), f.deps)).rejects.toMatchObject({
        status: 403,
      });
      expect(f.mutate).not.toHaveBeenCalled();
    },
  );
  it('client cannot create a designed page or grant itself design capability', async () => {
    const f = clientFixture();
    await expect(
      executeContent(
        {
          restaurantId,
          action: 'create',
          kind: 'page',
          manageDesign: true,
          permissions: { manageDesign: true },
          document: { ...page, blocks },
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it.each(['publish', 'restore', 'discard'])(
    'client cannot %s a privileged design draft',
    async (action) => {
      const f = clientFixture();
      if (action === 'restore') f.docs.get('p')!.status = 'hidden';
      f.docs.set('drafts.p', {
        ...f.docs.get('p')!,
        _id: 'drafts.p',
        _rev: 'draft',
        blocks: [{ ...blocks[0], variant: 'cover' }, blocks[1]],
      });
      await expect(
        executeContent(
          { restaurantId, action, kind: 'page', id: 'p', publishedRev: 'pub', draftRev: 'draft' },
          f.deps,
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(f.mutate).not.toHaveBeenCalled();
    },
  );
  it('design capability is fail-closed, and tenant authorization precedes capability lookup', async () => {
    const f = clientFixture();
    await expect(
      executeContent(save({ ...page, blocks: [] }), { authorize: async () => f.store }),
    ).rejects.toMatchObject({ status: 403 });
    f.deps.authorize.mockRejectedValue(new HttpError(403, 'Wrong tenant'));
    await expect(executeContent(save({ ...page, blocks }), f.deps)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.deps.canManageDesign).not.toHaveBeenCalled();
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it('Super Admin retains design configuration after normal tenant authorization', async () => {
    const f = clientFixture();
    f.deps.canManageDesign.mockResolvedValue(true);
    const result = await executeContent(
      save({ ...page, blocks: [{ ...blocks[0], variant: 'cover' }, blocks[1]] }),
      f.deps,
    );
    expect(result).toMatchObject({ permissions: { manageDesign: true, designDraft: true } });
  });
  it.each(['theme', 'logo'])('client cannot replace or unset global branding %s', async (field) => {
    const f = clientFixture();
    const settings = {
      name: 'Restaurant',
      tagline: 'Tagline',
      concept: 'Concept',
      address: 'Address',
      email: 'test@example.test',
      phone: '000',
      isFictional: true,
      hours: [{ days: 'Monday', time: '12:00' }],
      theme: { preset: 'modern' },
      logo: {
        _type: 'editorialImage',
        alt: 'Logo',
        asset: { _type: 'reference', _ref: 'image-logo' },
      },
    };
    f.docs.set('restaurant-settings', {
      ...settings,
      _type: 'settings',
      _id: 'restaurant-settings',
      _rev: 's',
    });
    const changed: Record<string, unknown> = { ...settings };
    delete changed[field];
    await expect(
      executeContent(
        {
          restaurantId,
          action: 'save',
          visualContractVersion: 2,
          kind: 'settings',
          id: 'restaurant-settings',
          publishedRev: 's',
          draftRev: null,
          document: changed,
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.mutate).not.toHaveBeenCalled();
  });
});
