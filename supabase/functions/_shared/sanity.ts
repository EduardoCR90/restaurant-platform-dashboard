import {
  HttpError,
  type ContentStore,
  type SanityDocument,
} from '../../../shared/editor-service.ts';
import type { JsonRecord } from '../../../shared/content.ts';
import { assertSanityWriteTarget } from './sanity-write-policy.ts';

export function sanityStore(
  projectId: string,
  dataset: string,
  token: string,
  authorization?: { restaurantId: string; integrationId: string; productionTarget?: string },
): ContentStore {
  const target = Object.freeze({
    projectId,
    dataset,
    restaurantId: authorization?.restaurantId || '',
    integrationId: authorization?.integrationId || '',
  });
  const productionTarget = authorization?.productionTarget;
  const base = `https://${projectId}.api.sanity.io/v2025-02-19`;
  async function call(path: string, init: RequestInit = {}) {
    // Límite HTTP común para mutaciones (incluido borradores/publicación) y assets.
    if ((init.method || 'GET').toUpperCase() !== 'GET')
      assertSanityWriteTarget(target, productionTarget);
    const response = await fetch(base + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (!response.ok) {
      if (response.status === 409)
        throw new HttpError(409, 'Otro editor ha cambiado el documento. Recarga para revisar.');
      throw new HttpError(
        502,
        'Sanity rechazó la operación; revisa la integración y sus permisos.',
      );
    }
    return await response.json();
  }
  return {
    async query<T>(query: string, params: Record<string, unknown>): Promise<T> {
      const search = new URLSearchParams({ query, perspective: 'raw' });
      for (const [key, value] of Object.entries(params))
        search.set('$' + key, JSON.stringify(value));
      const result = await call(`/data/query/${dataset}?${search}`);
      return result.result as T;
    },
    async mutate(mutations: JsonRecord[]) {
      return (await call(
        `/data/mutate/${dataset}?returnIds=true&returnDocuments=true&visibility=sync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mutations }),
        },
      )) as { results: { id: string; document?: SanityDocument }[] };
    },
    async upload(bytes: Uint8Array, mime: string) {
      const result = await call(`/assets/images/${dataset}`, {
        method: 'POST',
        headers: { 'Content-Type': mime },
        body: bytes.slice().buffer,
      });
      return { _id: result.document._id as string, url: result.document.url as string };
    },
  };
}
