import { z } from 'zod';
import { HttpError } from '../../../shared/editor-service.ts';

export const productionTargetSchema = z
  .object({
    restaurantId: z.uuid(),
    integrationId: z.uuid(),
    projectId: z.literal('hfa8zkyw'),
    dataset: z.literal('production'),
  })
  .strict();
export type SanityWriteTarget = {
  restaurantId: string;
  integrationId: string;
  projectId: string;
  dataset: string;
};
export const managedProductionSchema = z
  .object({
    restaurantId: z.uuid(),
    integrationId: z.uuid(),
    projectId: z.string().regex(/^[a-z0-9]{5,16}$/),
    dataset: z.literal('production'),
    keyVersion: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  })
  .strict();

export function assertSanityWriteTarget(
  target: SanityWriteTarget,
  configuration?: string,
  managedProduction?: unknown,
): void {
  // El entorno opcional de production jamás interfiere en las integraciones de staging.
  if (target.dataset === 'staging') return;
  const managed = managedProductionSchema.safeParse(managedProduction);
  if (
    target.dataset === 'production' &&
    managed.success &&
    (['restaurantId', 'integrationId', 'projectId', 'dataset'] as const).every(
      (key) => managed.data[key] === target[key],
    )
  )
    return;
  if (target.dataset !== 'production' || !configuration)
    throw new HttpError(403, 'Destino de escritura Sanity no autorizado');
  let allowed: z.infer<typeof productionTargetSchema>;
  try {
    if (configuration.length > 2048) throw new Error();
    allowed = productionTargetSchema.parse(JSON.parse(configuration));
  } catch {
    throw new HttpError(503, 'Política de escritura de Salitre pendiente de configuración válida');
  }
  if (
    (Object.keys(allowed) as (keyof typeof allowed)[]).some((key) => allowed[key] !== target[key])
  )
    throw new HttpError(403, 'Destino de escritura Sanity no autorizado');
}
