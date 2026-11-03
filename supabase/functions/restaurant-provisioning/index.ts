import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  restaurantProvisioningJob,
  restaurantProvisioningList,
  restaurantProvisioningRequest,
  type RestaurantProvisioningErrorCode,
  type RestaurantProvisioningStage,
} from '../../../shared/restaurant-provisioning.ts';
import { astroProvisioningJob } from '../../../shared/astro-provisioning.ts';
import { sanityProvisioningJob } from '../../../shared/sanity-provisioning.ts';
import { HttpError } from '../../../shared/editor-service.ts';
import { authenticate } from '../_shared/auth.ts';
import { adminSupabaseConfiguration } from '../_shared/environment.ts';
import { handler, limitedJson } from '../_shared/http.ts';
import { restaurantProvisioningIdentity } from '../_shared/restaurant-provisioning-request.ts';
import {
  restaurantProvisioningClaim,
  RestaurantProvisioningStepError,
  runRestaurantProvisioning,
  type RestaurantProvisioningStore,
} from '../_shared/restaurant-provisioning-service.ts';
import {
  logProvisioningDiagnostic,
  sanityProvisioningDiagnostics,
} from '../_shared/provisioning-diagnostics.ts';

function databaseFailure(): never {
  throw new HttpError(503, 'No se pudo registrar el estado del alta');
}

function configurationReady(env: (name: string) => string | undefined) {
  const all = (...names: string[]) => names.every((name) => Boolean(env(name)?.trim()));
  const sanity = sanityProvisioningDiagnostics(env);
  return {
    sanity,
    astro: all(
      'GITHUB_PROVISIONER_TOKEN',
      'GITHUB_REPOSITORY_OWNER',
      'GITHUB_TEMPLATE_REPOSITORY',
      'GITHUB_TEMPLATE_REPOSITORY_ID',
      'GITHUB_INSTANCE_BOOTSTRAP_WORKFLOW',
      'GITHUB_INSTANCE_VISIBILITY',
    ),
    invitations: Boolean(env('INVITE_REDIRECT_URL')?.startsWith('https://')),
  };
}

function store(
  admin: SupabaseClient,
  actor: string,
  requestId: string,
  lease: string,
): RestaurantProvisioningStore {
  const call = async (name: string, payload: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, payload);
    if (error || !data) databaseFailure();
    return restaurantProvisioningJob.parse(data);
  };
  return {
    checkpoint(stage: RestaurantProvisioningStage, evidence = {}) {
      return call('admin_checkpoint_restaurant_provisioning', {
        actor,
        request: requestId,
        lease,
        next_stage: stage,
        evidence: {
          restaurant_id: evidence.restaurantId,
          integration_id: evidence.integrationId,
          repository: evidence.repository,
          site_url: evidence.siteUrl,
        },
      });
    },
    wait() {
      return call('admin_wait_restaurant_provisioning', { actor, request: requestId, lease });
    },
    prepareInvitation() {
      return call('admin_prepare_restaurant_invitation', {
        actor,
        request: requestId,
        lease,
      });
    },
    complete(userId: string) {
      return call('admin_complete_restaurant_provisioning', {
        actor,
        request: requestId,
        lease,
        client: userId,
      });
    },
    fail(input: {
      code: RestaurantProvisioningErrorCode;
      retryable: boolean;
      manualReview: boolean;
    }) {
      return call('admin_fail_restaurant_provisioning', {
        actor,
        request: requestId,
        lease,
        code: input.code,
        can_retry: input.retryable,
        needs_review: input.manualReview,
      });
    },
  };
}

async function childRequest(
  url: string,
  authorization: string,
  origin: string,
  body: unknown,
  category: 'sanity' | 'astro',
) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authorization, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new RestaurantProvisioningStepError(category, true);
  }
  if (!response.ok) {
    // The child endpoints retain their detailed safe status. The aggregate exposes only the stage.
    throw new RestaurantProvisioningStepError(
      category,
      response.status >= 500,
      response.status === 409,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new RestaurantProvisioningStepError(category, false, true);
  }
}

Deno.serve(
  handler(async (request) => {
    const { client, user } = await authenticate(request);
    const { data: allowed, error: authError } = await client.rpc('is_platform_admin');
    if (authError || allowed !== true)
      throw new HttpError(403, 'Requiere administrador global activo');
    const input = restaurantProvisioningRequest.parse(await limitedJson(request));
    const environment = (name: string) => Deno.env.get(name);
    const { url, key } = adminSupabaseConfiguration(environment);
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (input.operation === 'list') {
      const { data, error } = await admin.rpc('admin_list_restaurant_provisioning', {
        actor: user.id,
        maximum: input.payload.limit,
      });
      if (error || !data) databaseFailure();
      return restaurantProvisioningList.parse(data);
    }

    const payload: Record<string, unknown> = { request_id: input.payload.request_id };
    if (input.operation === 'start') {
      const normalized = {
        ...input.payload,
        client_email: input.payload.client_email.toLowerCase(),
      };
      const identity = await restaurantProvisioningIdentity(normalized);
      Object.assign(payload, {
        request_hash: identity.requestHash,
        name: normalized.name,
        slug: normalized.slug,
        client_email: normalized.client_email,
        client_role: normalized.client_role,
        template_key: normalized.template.template_key,
        template_version: normalized.template.version,
        visual: normalized.visual,
        modules: normalized.modules,
        custom_domain: normalized.domain?.hostname || '',
        domain_mode: normalized.domain?.mode || '',
        sanity_request_id: identity.sanityRequestId,
        astro_request_id: identity.astroRequestId,
      });
    }
    const { data, error } = await admin.rpc('admin_claim_restaurant_provisioning', {
      actor: user.id,
      operation: input.operation,
      payload,
    });
    if (error || !data)
      throw new HttpError(409, 'Alta rechazada por conflicto, estado o ejecución concurrente');
    const claim = restaurantProvisioningClaim(data);
    if (!claim.execute) return claim.job;

    const configuration = configurationReady(environment);
    if (claim.job.stage === 'sanity' && !configuration.sanity.ready)
      logProvisioningDiagnostic({
        event: 'provisioning.configuration',
        component: 'restaurant-provisioning',
        request_id: claim.job.request_id,
        operation: input.operation,
        outcome: 'rejected',
        missing: configuration.sanity.missing,
        invalid: configuration.sanity.invalid,
      });

    const authorization = request.headers.get('Authorization');
    const origin = request.headers.get('Origin');
    if (!authorization?.startsWith('Bearer ') || !origin)
      throw new HttpError(401, 'Falta la sesión administrativa');
    const root = new URL(url);
    const child = (name: string) => new URL(`/functions/v1/${name}`, root).href;
    return runRestaurantProvisioning(claim, input.operation, {
      readiness: {
        sanity: configuration.sanity.ready,
        astro: configuration.astro,
        invitations: configuration.invitations,
      },
      children: {
        async sanity(operation, job) {
          const body =
            operation === 'start'
              ? {
                  operation,
                  payload: {
                    request_id: job.sanity_request_id,
                    name: job.name,
                    slug: job.slug,
                    dataset: 'production',
                  },
                }
              : { operation, payload: { request_id: job.sanity_request_id } };
          return sanityProvisioningJob.parse(
            await childRequest(child('sanity-provisioning'), authorization, origin, body, 'sanity'),
          );
        },
        async astro(operation, job) {
          const body =
            operation === 'start'
              ? {
                  operation,
                  payload: {
                    request_id: job.astro_request_id,
                    sanity_request_id: job.sanity_request_id,
                    template: job.template,
                    visual: job.visual,
                    modules: job.modules,
                    ...(job.domain ? { custom_domain: job.domain.hostname } : {}),
                  },
                }
              : { operation, payload: { request_id: job.astro_request_id } };
          return astroProvisioningJob.parse(
            await childRequest(child('astro-provisioning'), authorization, origin, body, 'astro'),
          );
        },
      },
      assignment: {
        async ensure(email) {
          const redirect = environment('INVITE_REDIRECT_URL');
          if (!redirect?.startsWith('https://'))
            throw new RestaurantProvisioningStepError('configuration', true);
          const { data: invitation, error: invitationError } =
            await admin.auth.admin.inviteUserByEmail(email, { redirectTo: redirect });
          if (invitationError || !invitation.user)
            throw new RestaurantProvisioningStepError('invitation', true);
          return { userId: invitation.user.id };
        },
      },
      store: store(admin, user.id, claim.job.request_id, claim.leaseToken!),
    });
  }),
);
