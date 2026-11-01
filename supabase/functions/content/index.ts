import { executeContent, HttpError } from '../../../shared/editor-service.ts';
import { authenticate } from '../_shared/auth.ts';
import { resolveContentIntegration } from '../_shared/content-authorization.ts';
import { handler, limitedJson } from '../_shared/http.ts';
import { contentRequest } from '../../../shared/content.ts';
import { observePublication } from '../../../shared/publication-mutation.ts';
import { publicationAdmin, publicationJournal } from '../_shared/publications.ts';
import { sanityStore } from '../_shared/sanity.ts';
Deno.serve(
  handler(async (request) => {
    const { client, user } = await authenticate(request);
    const input = contentRequest.parse(await limitedJson(request));
    let publicationId: string | undefined;
    const result = await executeContent(input, {
      authorize: async (restaurantId) => {
        const integration = await resolveContentIntegration(restaurantId, {
          authorize: async (id) => {
            const { data, error } = await client.rpc('authorize_content', { restaurant: id });
            if (error)
              throw new HttpError(
                403,
                'Sin autorización editorial, módulo no contratado/desactivado o integración pendiente',
              );
            return data;
          },
          readIntegration: async (id, restaurant) => {
            const { data, error } = await client
              .from('restaurant_integrations')
              .select('id,restaurant_id,provider,external_project_id,external_dataset')
              .eq('id', id)
              .eq('restaurant_id', restaurant)
              .single();
            if (error)
              throw new HttpError(403, 'Integración editorial no disponible para este restaurante');
            return data;
          },
        });
        const tokens: unknown = JSON.parse(Deno.env.get('SANITY_TOKENS') || '{}');
        const token =
          typeof tokens === 'object' && tokens !== null
            ? (tokens as Record<string, unknown>)[integration.integrationId]
            : undefined;
        if (typeof token !== 'string' || !token)
          throw new HttpError(503, 'Token de integración pendiente de configuración');
        const store = sanityStore(integration.projectId, integration.dataset, token, {
          restaurantId: integration.restaurantId,
          integrationId: integration.integrationId,
          productionTarget: Deno.env.get('SALITRE_PRODUCTION_WRITE_TARGET'),
        });
        if (
          input.action === 'publish' ||
          input.action === 'withdraw' ||
          input.action === 'restore'
        ) {
          publicationId = input.operationId || crypto.randomUUID();
          const journal = await publicationJournal(publicationAdmin(), {
            ...integration,
            operationId: publicationId,
            actorId: user.id,
            documentId: input.id,
            action: input.action,
            previousRev: input.publishedRev,
          });
          return observePublication(store, { ...integration, documentId: input.id }, journal);
        }
        return store;
      },
    });
    return publicationId ? { ...(result as Record<string, unknown>), publicationId } : result;
  }),
);
