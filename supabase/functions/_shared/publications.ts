import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../../shared/editor-service.ts';
import { revisionFingerprint } from '../../../shared/publications.ts';
import { adminSupabaseConfiguration } from './environment.ts';
import type { PublicationJournal } from '../../../shared/publication-mutation.ts';
export function publicationAdmin() {
  const { url, key } = adminSupabaseConfiguration((name) => Deno.env.get(name));
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function checkDatabase(error: unknown) {
  if (error) throw new HttpError(503, 'No se pudo registrar o consultar el estado de publicación');
}
export async function publicationJournal(
  db: SupabaseClient,
  input: {
    operationId: string;
    restaurantId: string;
    integrationId: string;
    actorId: string;
    projectId: string;
    dataset: string;
    documentId: string;
    action: 'publish' | 'withdraw' | 'restore';
    previousRev: string | null;
  },
): Promise<PublicationJournal> {
  const { data: config, error } = await db
    .from('website_deployments')
    .select('id,project_id,dataset')
    .eq('restaurant_id', input.restaurantId)
    .eq('integration_id', input.integrationId)
    .eq('enabled', true)
    .maybeSingle();
  checkDatabase(error);
  const target =
    config?.project_id === input.projectId && config?.dataset === input.dataset
      ? (config.id as string)
      : null;
  const previous = input.previousRev
    ? await revisionFingerprint(input.projectId, input.dataset, input.documentId, input.previousRev)
    : null;
  return {
    async begin() {
      const { error } = await db.from('publication_operations').insert({
        id: input.operationId,
        restaurant_id: input.restaurantId,
        integration_id: input.integrationId,
        deployment_id: target,
        actor_id: input.actorId,
        document_id: input.documentId,
        action: input.action,
        previous_fingerprint: previous,
      });
      if (error?.code === '23505')
        throw new HttpError(409, 'Operación ya registrada. Consulta su estado antes de repetirla.');
      checkDatabase(error);
    },
    async accept(fingerprint) {
      const { error } = await db
        .from('publication_operations')
        .update({
          fingerprint,
          accepted_at: new Date().toISOString(),
          state: target ? 'awaiting_deployment' : 'deployment_error',
          error_code: target ? null : 'not_configured',
        })
        .eq('id', input.operationId)
        .eq('restaurant_id', input.restaurantId);
      checkDatabase(error);
      if (target) checkDatabase((await db.rpc('reconcile_publications', { target })).error);
    },
    async fail() {
      checkDatabase(
        (
          await db
            .from('publication_operations')
            .update({ state: 'sanity_error', error_code: 'sanity_rejected' })
            .eq('id', input.operationId)
            .eq('restaurant_id', input.restaurantId)
        ).error,
      );
    },
  };
}
