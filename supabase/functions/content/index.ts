import { executeContent, HttpError } from '../../../shared/editor-service.ts';
import { authenticate } from '../_shared/auth.ts';
import { resolveContentIntegration } from '../_shared/content-authorization.ts';
import { handler, limitedJson } from '../_shared/http.ts';
import { sanityStore } from '../_shared/sanity.ts';
Deno.serve(
  handler(async (request) => {
    const { client } = await authenticate(request);
    return executeContent(await limitedJson(request), {
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
        return sanityStore(integration.projectId, integration.dataset, token, {
          restaurantId: integration.restaurantId,
          integrationId: integration.integrationId,
          productionTarget: Deno.env.get('SALITRE_PRODUCTION_WRITE_TARGET'),
        });
      },
    });
  }),
);
