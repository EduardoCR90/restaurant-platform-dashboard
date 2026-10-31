import { z } from 'zod';
import { HttpError } from '../../../shared/editor-service.ts';

export const integrationSchema = z.object({
  id: z.uuid(),
  projectId: z.string().regex(/^[a-z0-9]{1,32}$/),
  dataset: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  schema: z.literal('salitre-v1'),
});

// La RPC existente verifica identidad, membresía/administrador, rol, estado y módulo.
const integrationRow = z.object({
  id: z.uuid(),
  restaurant_id: z.uuid(),
  provider: z.literal('sanity'),
  external_project_id: z.string(),
  external_dataset: z.string(),
});
export type AuthorizationDependencies = {
  authorize(restaurantId: string): Promise<unknown>;
  readIntegration(integrationId: string, restaurantId: string): Promise<unknown>;
};
export async function resolveContentIntegration(
  restaurantId: string,
  deps: AuthorizationDependencies,
) {
  z.uuid().parse(restaurantId);
  const authorized = integrationSchema.parse(await deps.authorize(restaurantId));
  const row = integrationRow.parse(await deps.readIntegration(authorized.id, restaurantId));
  // Segunda lectura con JWT/RLS: los UUID y el destino vienen de Supabase, no del cuerpo HTTP.
  if (
    row.id !== authorized.id ||
    row.restaurant_id !== restaurantId ||
    row.external_project_id !== authorized.projectId ||
    row.external_dataset !== authorized.dataset
  )
    throw new HttpError(409, 'La integración ha cambiado; recarga antes de continuar');
  return Object.freeze({
    restaurantId: row.restaurant_id,
    integrationId: row.id,
    projectId: authorized.projectId,
    dataset: authorized.dataset,
  });
}
