import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  astroProvisioningCallback,
  astroProvisioningJob,
  astroProvisioningRequest,
  type AstroProvisioningStage,
} from '../../../shared/astro-provisioning.ts';
import { verifyGithubIdentity } from '../../../shared/github-oidc.ts';
import { HttpError } from '../../../shared/editor-service.ts';
import { authenticate } from '../_shared/auth.ts';
import { adminSupabaseConfiguration } from '../_shared/environment.ts';
import { githubKeys } from '../_shared/github-jwks.ts';
import { githubManagement, githubProvisioningConfiguration } from '../_shared/github-management.ts';
import { handler, limitedJson } from '../_shared/http.ts';
import {
  astroProvisioningClaim,
  AstroProvisioningDatabaseError,
  runAstroProvisioning,
  verifyProvisionedSource,
  type AstroProvisioningStore,
} from '../_shared/astro-provisioning-service.ts';
import { logAstroRepositoryValidation } from '../_shared/astro-provisioning-diagnostics.ts';
import {
  astroCallbackDiagnostic,
  logAstroCallbackFailure,
  type AstroCallbackPhase,
} from '../_shared/astro-callback-diagnostics.ts';
import { astroRequestHash } from '../_shared/astro-provisioning-request.ts';

function databaseFailure(error: unknown): never {
  void error;
  throw new AstroProvisioningDatabaseError();
}

function endpoints(url: string) {
  const root = new URL(url);
  return {
    publication: new URL('/functions/v1/publications', root).href,
    provisioning: new URL('/functions/v1/astro-provisioning', root).href,
  };
}

function provisioningStore(
  admin: SupabaseClient,
  actor: string,
  requestId: string,
  leaseToken: string,
): AstroProvisioningStore {
  return {
    async checkpoint(stage: AstroProvisioningStage, evidence = {}) {
      const { data, error } = await admin.rpc('admin_checkpoint_astro_provisioning', {
        actor,
        request: requestId,
        lease: leaseToken,
        next_stage: stage,
        evidence: {
          repository_id: evidence.repositoryId,
          specification_hash: evidence.specificationHash,
        },
      });
      if (error || !data) databaseFailure(error);
      return astroProvisioningJob.parse(data);
    },
    async awaitCallback() {
      const { data, error } = await admin.rpc('admin_await_astro_callback', {
        actor,
        request: requestId,
        lease: leaseToken,
      });
      if (error || !data) databaseFailure(error);
      return astroProvisioningJob.parse(data);
    },
    async complete({ pagesUrl }) {
      const { data, error } = await admin.rpc('admin_complete_astro_provisioning', {
        actor,
        request: requestId,
        lease: leaseToken,
        pages_url: pagesUrl,
      });
      if (error || !data) databaseFailure(error);
      return astroProvisioningJob.parse(data);
    },
    async fail(input) {
      const { data, error } = await admin.rpc('admin_fail_astro_provisioning', {
        actor,
        request: requestId,
        lease: leaseToken,
        code: input.code,
        can_retry: input.retryable,
        needs_review: input.manualReview,
      });
      if (error || !data) databaseFailure(error);
      return astroProvisioningJob.parse(data);
    },
  };
}

Deno.serve(
  handler(
    async (request) => {
      const raw = await limitedJson(request);
      const environment = (name: string) => Deno.env.get(name);
      const { url, key } = adminSupabaseConfiguration(environment);
      const admin = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const reportEndpoints = endpoints(url);

      if (typeof raw === 'object' && raw && 'action' in raw && raw.action === 'source_ready') {
        let phase: AstroCallbackPhase = 'identity';
        let requestId: string | null = null;
        try {
          const github = githubManagement(githubProvisioningConfiguration(environment));
          const input = astroProvisioningCallback.parse(raw);
          requestId = input.request_id;
          const authorization = request.headers.get('Authorization');
          if (!authorization?.startsWith('Bearer '))
            throw new HttpError(401, 'Falta la identidad del workflow');
          const claims = await verifyGithubIdentity(
            authorization.slice(7),
            await githubKeys(),
            Date.now(),
            {
              audience: 'restaurant-platform-provisioning',
              workflowPath: '.github/workflows/bootstrap-instance.yml',
            },
          );
          phase = 'state_lookup';
          const row = await admin
            .from('astro_provisioning_jobs')
            .select('created_by')
            .eq('request_id', input.request_id)
            .maybeSingle();
          if (row.error || !row.data) throw new HttpError(403, 'Workflow no autorizado');
          const current = await admin.rpc('admin_get_astro_provisioning', {
            actor: row.data.created_by,
            request: input.request_id,
          });
          if (current.error || !current.data) databaseFailure(current.error);
          const job = astroProvisioningJob.parse(current.data);
          if (
            claims.repository.toLowerCase() !== job.repository.toLowerCase() ||
            claims.repository_id !== job.repository_id
          )
            throw new HttpError(403, 'Workflow no autorizado para esta web');
          phase = 'source_verification';
          const evidence = await verifyProvisionedSource(
            job,
            { sourceCommit: input.source_commit, manifestHash: input.manifest_hash },
            github,
          );
          phase = 'state_confirmation';
          const confirmed = await admin.rpc('admin_confirm_astro_source', {
            request: job.request_id,
            repository_name: claims.repository,
            repository_identity: claims.repository_id,
            source: evidence.sourceCommit,
            manifest: evidence.manifestHash,
          });
          if (confirmed.error || !confirmed.data) databaseFailure(confirmed.error);
          const claim = astroProvisioningClaim(confirmed.data);
          if (!claim.execute) return claim.job;
          phase = 'pages_registration';
          return await runAstroProvisioning(claim, {
            github,
            store: provisioningStore(admin, row.data.created_by, job.request_id, claim.leaseToken!),
            endpoints: reportEndpoints,
          });
        } catch (error) {
          const diagnostic = astroCallbackDiagnostic(phase, error);
          logAstroCallbackFailure(requestId, diagnostic);
          throw new HttpError(
            diagnostic.status,
            `Callback Astro rechazado (${diagnostic.phase}/${diagnostic.category})`,
          );
        }
      }

      const { client, user } = await authenticate(request);
      const { data: allowed, error: authError } = await client.rpc('is_platform_admin');
      if (authError || allowed !== true)
        throw new HttpError(403, 'Requiere administrador global activo');
      const input = astroProvisioningRequest.parse(raw);
      if (input.operation === 'status') {
        const { data, error } = await admin.rpc('admin_get_astro_provisioning', {
          actor: user.id,
          request: input.payload.request_id,
        });
        if (error || !data) databaseFailure(error);
        return astroProvisioningJob.parse(data);
      }

      const configuration = githubProvisioningConfiguration(environment);
      const github = githubManagement(configuration);
      const payload: Record<string, unknown> = { request_id: input.payload.request_id };
      if (input.operation === 'start') {
        Object.assign(payload, {
          request_hash: await astroRequestHash({
            input: input.payload,
            configuration: {
              owner: configuration.owner,
              template_repository: configuration.templateRepository,
              template_repository_id: configuration.templateRepositoryId,
              visibility: configuration.visibility,
              endpoints: reportEndpoints,
            },
          }),
          sanity_request_id: input.payload.sanity_request_id,
          template_key: input.payload.template.template_key,
          template_version: input.payload.template.version,
          visual: input.payload.visual,
          modules: input.payload.modules,
          custom_domain: input.payload.custom_domain || '',
          repository_owner: configuration.owner,
          visibility: configuration.visibility,
          publication_endpoint: reportEndpoints.publication,
          provisioning_endpoint: reportEndpoints.provisioning,
        });
      }
      const { data, error } = await admin.rpc('admin_claim_astro_provisioning', {
        actor: user.id,
        operation: input.operation,
        payload,
      });
      if (error || !data)
        throw new HttpError(
          409,
          'Aprovisionamiento web rechazado por conflicto, estado o ejecución concurrente',
        );
      const claim = astroProvisioningClaim(data);
      if (!claim.execute) return claim.job;
      return runAstroProvisioning(claim, {
        github,
        store: provisioningStore(admin, user.id, claim.job.request_id, claim.leaseToken!),
        endpoints: reportEndpoints,
        observeRepositoryValidation: (observation) =>
          logAstroRepositoryValidation({
            event: 'astro-provisioning.repository-validation',
            component: 'astro-provisioning',
            request_id: claim.job.request_id,
            ...observation,
          }),
      });
    },
    { serverToServer: true },
  ),
);
