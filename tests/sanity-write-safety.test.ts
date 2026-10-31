// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanityStore } from '../supabase/functions/_shared/sanity';
import { executeContent } from '../shared/editor-service';

afterEach(() => vi.unstubAllGlobals());
const projectId = 'hfa8zkyw';
const token = 'isolated-test-token-not-a-real-credential';
const restaurantId = '00000000-0000-4000-8000-000000000001';

describe('Barrera de escrituras Sanity en servidor', () => {
  it.each([
    'production',
    'test',
    'Staging',
    '',
    'staging/../production',
    'staging%2f..%2fproduction',
  ])('bloquea mutaciones y uploads a %j antes de cualquier petición HTTP', async (dataset) => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const store = sanityStore(projectId, dataset, token);
    // Incluye creación de borradores, edición, publicación y borrado de borrador.
    for (const mutation of [
      { create: { _id: 'drafts.', _type: 'page' } },
      { patch: { id: 'drafts.page1', set: { title: 'Cambio' } } },
      { create: { _id: 'page1', _type: 'page' } },
      { delete: { id: 'drafts.page1' } },
    ])
      await expect(store.mutate([mutation])).rejects.toMatchObject({ status: 403 });
    await expect(store.upload(new Uint8Array([255, 216, 255]), 'image/jpeg')).rejects.toMatchObject(
      { status: 403 },
    );
    expect(network).not.toHaveBeenCalled();
  });

  it('permite mutación e imagen en staging del proyecto autorizado, sin seguir redirecciones', async () => {
    const network = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            results: [{ id: 'drafts.generated' }],
            document: { _id: 'image-test', url: 'https://cdn.sanity.io/test.jpg' },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', network);
    const store = sanityStore(projectId, 'staging', token);
    await store.mutate([{ create: { _id: 'drafts.', _type: 'category', name: 'Ensayo' } }]);
    await store.upload(new Uint8Array([255, 216, 255]), 'image/jpeg');
    expect(network.mock.calls[0][0]).toContain(
      'https://hfa8zkyw.api.sanity.io/v2025-02-19/data/mutate/staging?',
    );
    expect(network.mock.calls[1][0]).toBe(
      'https://hfa8zkyw.api.sanity.io/v2025-02-19/assets/images/staging',
    );
    for (const [, init] of network.mock.calls)
      expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
  });

  it('mantiene lectura de producción, sin convertirla en autorización de escritura', async () => {
    const network = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: [] }), { status: 200 }));
    vi.stubGlobal('fetch', network);
    const store = sanityStore(projectId, 'production', token);
    expect(await store.query('*[_type==$type]', { type: 'page' })).toEqual([]);
    expect(network.mock.calls[0][0]).toContain('/data/query/production?');
    expect(network.mock.calls[0][1]).not.toHaveProperty('method');
    await expect(store.mutate([])).rejects.toMatchObject({ status: 403 });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('no acepta dataset/projectId del cliente como forma de eludir el destino resuelto en backend', async () => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const authorize = vi.fn(async () => sanityStore(projectId, 'production', token));
    await expect(
      executeContent(
        {
          restaurantId,
          action: 'upload',
          mime: 'image/jpeg',
          data: btoa(String.fromCharCode(255, 216, 255)),
          dataset: 'staging',
          projectId: 'other',
        },
        { authorize },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(authorize).toHaveBeenCalledWith(restaurantId);
    expect(network).not.toHaveBeenCalled();
  });

  it('la restricción no fija un restaurante o proyecto: cada integración conserva su aislamiento', async () => {
    const network = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal('fetch', network);
    await sanityStore('anotherproject', 'staging', token).mutate([]);
    expect(network.mock.calls[0][0]).toContain(
      'https://anotherproject.api.sanity.io/v2025-02-19/data/mutate/staging?',
    );
  });
});
