import { executeContent, HttpError } from '../../../shared/editor-service.ts';
import { authenticate, integrationSchema } from '../_shared/auth.ts';
import { handler, limitedJson } from '../_shared/http.ts';
import { sanityStore } from '../_shared/sanity.ts';
Deno.serve(
  handler(async (request) => {
    const { client } = await authenticate(request);
    return executeContent(await limitedJson(request), {
      authorize: async (restaurantId) => {
        const { data, error } = await client.rpc('authorize_content', { restaurant: restaurantId });
        if (error)
          throw new HttpError(
            403,
            'Sin autorización editorial, módulo no contratado/desactivado o integración pendiente',
          );
        const integration = integrationSchema.parse(data);
        const tokens: unknown = JSON.parse(Deno.env.get('SANITY_TOKENS') || '{}');
        const token =
          typeof tokens === 'object' && tokens !== null
            ? (tokens as Record<string, unknown>)[integration.id]
            : undefined;
        if (typeof token !== 'string' || !token)
          throw new HttpError(503, 'Token de integración pendiente de configuración');
        return sanityStore(integration.projectId, integration.dataset, token);
      },
    });
  }),
);
