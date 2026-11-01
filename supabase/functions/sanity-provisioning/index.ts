import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  sanityProvisioningJob,
  sanityProvisioningRequest,
  type SanityProvisioningStage,
} from '../../../shared/sanity-provisioning.ts';
import { HttpError } from '../../../shared/editor-service.ts';
import { authenticate } from '../_shared/auth.ts';
import { adminSupabaseConfiguration } from '../_shared/environment.ts';
import { handler, limitedJson } from '../_shared/http.ts';
import {
  credentialKeyring,
  encryptIntegrationCredential,
  type EncryptedCredential,
} from '../_shared/integration-credentials.ts';
import { sanityManagement, sanityProvisioningConfiguration } from '../_shared/sanity-management.ts';
import {
  provisioningClaim,
  runSanityProvisioning,
  type ProvisioningStore,
} from '../_shared/sanity-provisioning-service.ts';
import { provisioningIdentity } from '../_shared/provisioning-request.ts';

function databaseFailure(error: unknown): never {
  if (error) throw new HttpError(503, 'No se pudo registrar el estado de aprovisionamiento');
  throw new HttpError(503, 'Respuesta de aprovisionamiento no disponible');
}

function provisioningStore(
  admin: SupabaseClient,
  actor: string,
  requestId: string,
  leaseToken: string,
): ProvisioningStore {
  return {
    async checkpoint(stage: SanityProvisioningStage) {
      const { error } = await admin.rpc('admin_checkpoint_sanity_provisioning', {
        actor,
        request: requestId,
        lease: leaseToken,
        next_stage: stage,
      });
      if (error) databaseFailure(error);
    },
    async complete(input: { providerTokenId: string; credential: EncryptedCredential }) {
      const { data, error } = await admin.rpc('admin_complete_sanity_provisioning', {
        actor,
        request: requestId,
        lease: leaseToken,
        provider_token: input.providerTokenId,
        credential: input.credential,
      });
      if (error || !data) databaseFailure(error);
      return sanityProvisioningJob.parse(data);
    },
    async fail(input) {
      const { data, error } = await admin.rpc('admin_fail_sanity_provisioning', {
        actor,
        request: requestId,
        lease: leaseToken,
        code: input.code,
        can_retry: input.retryable,
        needs_review: input.manualReview,
      });
      if (error || !data) databaseFailure(error);
      return sanityProvisioningJob.parse(data);
    },
  };
}

Deno.serve(
  handler(async (request) => {
    const { client, user } = await authenticate(request);
    const { data: allowed, error: authError } = await client.rpc('is_platform_admin');
    if (authError || allowed !== true)
      throw new HttpError(403, 'Requiere administrador global activo');
    const input = sanityProvisioningRequest.parse(await limitedJson(request));
    const { url, key } = adminSupabaseConfiguration((name) => Deno.env.get(name));
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (input.operation === 'status') {
      const { data, error } = await admin.rpc('admin_get_sanity_provisioning', {
        actor: user.id,
        request: input.payload.request_id,
      });
      if (error || !data) databaseFailure(error);
      return sanityProvisioningJob.parse(data);
    }

    const environment = (name: string) => Deno.env.get(name);
    const sanityConfiguration = sanityProvisioningConfiguration(environment);
    const keyring = credentialKeyring(environment);
    const claimPayload: Record<string, unknown> = { request_id: input.payload.request_id };
    if (input.operation === 'start') {
      const identity = await provisioningIdentity(input.payload);
      Object.assign(claimPayload, {
        request_hash: identity.requestHash,
        name: input.payload.name,
        slug: input.payload.slug,
        project_id: identity.projectId,
        dataset: input.payload.dataset,
      });
    }
    const { data, error } = await admin.rpc('admin_claim_sanity_provisioning', {
      actor: user.id,
      operation: input.operation,
      payload: claimPayload,
    });
    if (error || !data)
      throw new HttpError(
        409,
        'Aprovisionamiento rechazado por conflicto, estado o ejecución concurrente',
      );
    const claim = provisioningClaim(data);
    if (!claim.execute) return claim.job;
    return runSanityProvisioning(claim, {
      sanity: sanityManagement(sanityConfiguration),
      store: provisioningStore(admin, user.id, claim.job.request_id, claim.leaseToken!),
      encrypt: (token, integrationId) =>
        encryptIntegrationCredential(token, integrationId, keyring),
    });
  }),
);
