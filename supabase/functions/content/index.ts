import { executeContent, HttpError } from '../../../shared/editor-service.ts';
import { authenticate } from '../_shared/auth.ts';
import { resolveContentIntegration } from '../_shared/content-authorization.ts';
import { handler, limitedJson } from '../_shared/http.ts';
import { contentRequest } from '../../../shared/content.ts';
import { observePublication } from '../../../shared/publication-mutation.ts';
import { publicationAdmin, publicationJournal } from '../_shared/publications.ts';
import { sanityStore } from '../_shared/sanity.ts';
import { resolveIntegrationCredential } from '../_shared/integration-credentials.ts';
Deno.serve(
  handler(async (request) => {
    const { client, user } = await authenticate(request);
    const input = contentRequest.parse(await limitedJson(request));
    let designPermission: boolean | undefined;
    let publicationId: string | undefined;
    const admin = publicationAdmin();
    const result = await executeContent(input, {
      canManageDesign: async () => {
        if (designPermission !== undefined) return designPermission;
        const { data, error } = await client.rpc('is_platform_admin');
        if (error) throw new HttpError(503, 'No se pudieron comprobar los permisos visuales');
        return (designPermission = data === true);
      },
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
        const credential = await resolveIntegrationCredential(
          integration.integrationId,
          (name) => Deno.env.get(name),
          async (id) => {
            const { data, error } = await admin
              .from('integration_credentials')
              .select('ciphertext,iv,key_version')
              .eq('integration_id', id)
              .maybeSingle();
            if (error && !['42P01', 'PGRST205'].includes(error.code))
              throw new HttpError(503, 'Credencial de integración no disponible');
            return data;
          },
        );
        const store = sanityStore(integration.projectId, integration.dataset, credential.token, {
          restaurantId: integration.restaurantId,
          integrationId: integration.integrationId,
          productionTarget: Deno.env.get('SALITRE_PRODUCTION_WRITE_TARGET'),
          ...(credential.managedKeyVersion
            ? {
                managedProduction: {
                  restaurantId: integration.restaurantId,
                  integrationId: integration.integrationId,
                  projectId: integration.projectId,
                  dataset: integration.dataset,
                  keyVersion: credential.managedKeyVersion,
                },
              }
            : {}),
        });
        if (
          input.action === 'publish' ||
          input.action === 'withdraw' ||
          input.action === 'restore'
        ) {
          publicationId = input.operationId || crypto.randomUUID();
          const journal = await publicationJournal(admin, {
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
