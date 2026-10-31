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
  return { store, docs, mutate, deps: { authorize: vi.fn(async () => store) } };
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
      { id: 'p', title: 'Edición', draft: true, published: true },
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
