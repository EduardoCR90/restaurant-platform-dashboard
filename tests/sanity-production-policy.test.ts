// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSanityWriteTarget } from '../supabase/functions/_shared/sanity-write-policy';
import { resolveContentIntegration } from '../supabase/functions/_shared/content-authorization';
import { sanityStore } from '../supabase/functions/_shared/sanity';
const restaurantId = '00000000-0000-4000-8000-000000000101';
const integrationId = '00000000-0000-4000-8000-000000000201';
const other = '00000000-0000-4000-8000-000000000999';
const target = { restaurantId, integrationId, projectId: 'hfa8zkyw', dataset: 'production' };
const configuration = JSON.stringify(target);
afterEach(() => vi.unstubAllGlobals());
describe('Excepción de production exacta y configurada en servidor', () => {
  it('permite exclusivamente la tupla completa; no concede permisos editoriales por sí misma', () => {
    expect(() => assertSanityWriteTarget(target, configuration)).not.toThrow();
  });
  it.each([
    { restaurantId: other },
    { integrationId: other },
    { projectId: 'otherproject' },
    { dataset: 'Production' },
    { dataset: 'test' },
    { dataset: 'production/../staging' },
  ])('deniega tuplas ajenas o manipuladas %j', (change) => {
    expect(() => assertSanityWriteTarget({ ...target, ...change }, configuration)).toThrow();
  });
  it.each([
    undefined,
    '',
    'true',
    '{}',
    '{invalid',
    JSON.stringify({ ...target, allowProduction: true }),
    JSON.stringify({ ...target, projectId: 'otherproject' }),
  ])('falla cerrado con configuración ausente o inválida', (value) => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const store = sanityStore(target.projectId, target.dataset, 'synthetic-secret', {
      restaurantId,
      integrationId,
      productionTarget: value,
    });
    return expect(store.mutate([]))
      .rejects.toThrow()
      .then(() => expect(network).not.toHaveBeenCalled());
  });
  it('una configuración inválida de producción no cambia staging para otros proyectos', () => {
    expect(() =>
      assertSanityWriteTarget(
        { ...target, restaurantId: other, projectId: 'anotherproject', dataset: 'staging' },
        '{invalid',
      ),
    ).not.toThrow();
  });
  it('autoriza HTTP de borradores/publicación/asset solo en el destino exacto, sin exponer tokens', async () => {
    const network = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            results: [],
            document: { _id: 'image-fixture', url: 'https://example.test/image.jpg' },
          }),
        ),
    );
    vi.stubGlobal('fetch', network);
    const store = sanityStore(target.projectId, target.dataset, 'synthetic-secret', {
      restaurantId,
      integrationId,
      productionTarget: configuration,
    });
    for (const mutation of [
      { create: { _id: 'drafts.fixture' } },
      { patch: { id: 'drafts.fixture', set: { title: 'Cambio' } } },
      { create: { _id: 'fixture' } },
      { delete: { id: 'drafts.fixture' } },
    ])
      await store.mutate([mutation]);
    await store.upload(new Uint8Array([255, 216, 255]), 'image/jpeg');
    expect(network).toHaveBeenCalledTimes(5);
    for (const [url, init] of network.mock.calls) {
      expect(url).toContain('https://hfa8zkyw.api.sanity.io/');
      expect(url).toContain('/production');
      expect(init.redirect).toBe('error');
    }
  });
  it('otro restaurante no puede reutilizar la política ni para subir imágenes', async () => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const store = sanityStore('hfa8zkyw', 'production', 'synthetic-secret', {
      restaurantId: other,
      integrationId,
      productionTarget: configuration,
    });
    await expect(store.mutate([])).rejects.toMatchObject({ status: 403 });
    await expect(store.upload(new Uint8Array([255, 216, 255]), 'image/jpeg')).rejects.toMatchObject(
      { status: 403 },
    );
    expect(network).not.toHaveBeenCalled();
  });
  it('los errores de JSON/política no incluyen valores de configuración', () => {
    expect(() => assertSanityWriteTarget(target, 'SYNTHETIC-PRIVATE-VALUE')).toThrow(
      'Política de escritura de Salitre pendiente de configuración válida',
    );
  });
});
describe('Production de integraciones aprovisionadas y cifradas', () => {
  const managedTarget = {
    restaurantId,
    integrationId,
    projectId: 'r1234567890abcde',
    dataset: 'production',
  };
  const evidence = { ...managedTarget, keyVersion: 'v1' };
  it('admite solo la evidencia backend de la misma integración', () => {
    expect(() => assertSanityWriteTarget(managedTarget, undefined, evidence)).not.toThrow();
    for (const changed of [
      { restaurantId: other },
      { integrationId: other },
      { projectId: 'r2234567890abcde' },
      { dataset: 'staging' },
      { keyVersion: '' },
      { allowProduction: true },
    ])
      expect(() =>
        assertSanityWriteTarget(managedTarget, undefined, { ...evidence, ...changed }),
      ).toThrow();
  });
  it('aplica la misma guarda antes de mutaciones y assets', async () => {
    const network = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            results: [],
            document: { _id: 'image-fixture', url: 'https://example.test/image.jpg' },
          }),
        ),
    );
    vi.stubGlobal('fetch', network);
    const store = sanityStore(managedTarget.projectId, 'production', 'encrypted-test-token', {
      restaurantId,
      integrationId,
      managedProduction: evidence,
    });
    await store.mutate([]);
    await store.upload(new Uint8Array([255, 216, 255]), 'image/jpeg');
    expect(network).toHaveBeenCalledTimes(2);
  });
});
describe('Resolución autorizada y fresca desde Supabase', () => {
  function deps() {
    return {
      authorize: vi.fn(async () => ({
        id: integrationId,
        projectId: 'hfa8zkyw',
        dataset: 'production',
        schema: 'salitre-v1',
      })),
      readIntegration: vi.fn(async () => ({
        id: integrationId,
        restaurant_id: restaurantId,
        provider: 'sanity',
        external_project_id: 'hfa8zkyw',
        external_dataset: 'production',
      })),
    };
  }
  it('resuelve UUID y destino desde la fila protegida por RLS después de la RPC', async () => {
    const d = deps();
    expect(await resolveContentIntegration(restaurantId, d)).toEqual(target);
    expect(d.authorize).toHaveBeenCalledWith(restaurantId);
    expect(d.readIntegration).toHaveBeenCalledWith(integrationId, restaurantId);
  });
  it('sin permiso editorial no lee integración ni llama a Sanity', async () => {
    const d = deps();
    d.authorize.mockRejectedValue(new Error('Forbidden'));
    await expect(resolveContentIntegration(restaurantId, d)).rejects.toThrow();
    expect(d.readIntegration).not.toHaveBeenCalled();
  });
  it.each([
    { restaurant_id: other },
    { id: other },
    { external_project_id: 'otherproject' },
    { external_dataset: 'staging' },
  ])('rechaza cambios concurrentes o mezcla de contexto %j', async (change) => {
    const d = deps();
    d.readIntegration.mockResolvedValue({ ...(await d.readIntegration()), ...change });
    await expect(resolveContentIntegration(restaurantId, d)).rejects.toMatchObject({ status: 409 });
  });
});
