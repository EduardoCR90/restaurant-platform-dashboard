import {
  restaurantProvisioningJob,
  type RestaurantProvisioningErrorCode,
  type RestaurantProvisioningJob,
  type RestaurantProvisioningStage,
} from '../../../shared/restaurant-provisioning.ts';
import type { AstroProvisioningJob } from '../../../shared/astro-provisioning.ts';
import type { SanityProvisioningJob } from '../../../shared/sanity-provisioning.ts';

export type RestaurantProvisioningClaim = {
  execute: boolean;
  leaseToken: string | null;
  job: RestaurantProvisioningJob;
};

export type ChildProvisioningClient = {
  sanity(
    operation: 'start' | 'retry' | 'status' | 'verify_admin',
    job: RestaurantProvisioningJob,
  ): Promise<SanityProvisioningJob>;
  astro(
    operation: 'start' | 'retry' | 'status',
    job: RestaurantProvisioningJob,
  ): Promise<AstroProvisioningJob>;
};

export type ClientAssignment = {
  ensure(email: string): Promise<{ userId: string }>;
};

export type RestaurantProvisioningStore = {
  checkpoint(
    stage: RestaurantProvisioningStage,
    evidence?: {
      restaurantId?: string;
      integrationId?: string;
      repository?: string;
      siteUrl?: string;
    },
  ): Promise<RestaurantProvisioningJob>;
  wait(): Promise<RestaurantProvisioningJob>;
  prepareInvitation(): Promise<RestaurantProvisioningJob>;
  complete(userId: string): Promise<RestaurantProvisioningJob>;
  fail(input: {
    code: RestaurantProvisioningErrorCode;
    retryable: boolean;
    manualReview: boolean;
  }): Promise<RestaurantProvisioningJob>;
};

export class RestaurantProvisioningStepError extends Error {
  constructor(
    public code: RestaurantProvisioningErrorCode,
    public retryable: boolean,
    public manualReview = false,
  ) {
    super(code);
  }
}

export function restaurantProvisioningClaim(raw: unknown): RestaurantProvisioningClaim {
  const value = raw as Record<string, unknown>;
  return {
    execute: value.execute === true,
    leaseToken: typeof value.lease_token === 'string' ? value.lease_token : null,
    job: restaurantProvisioningJob.parse(value.job),
  };
}

function childOperation(
  status: 'running' | 'succeeded' | 'failed' | 'manual_review' | undefined,
  retryable: boolean | undefined,
  requested: 'start' | 'retry' | 'status' | 'verify_sanity_admin',
) {
  if (!status) return 'start' as const;
  if (status === 'failed' && retryable && requested === 'retry') return 'retry' as const;
  return 'status' as const;
}

function sanityChildOperation(
  child: SanityProvisioningJob | null,
  requested: 'start' | 'retry' | 'status' | 'verify_sanity_admin',
) {
  if (!child) return 'start' as const;
  if (requested === 'verify_sanity_admin' && child.status === 'awaiting')
    return 'verify_admin' as const;
  if (child.status === 'failed' && child.retryable && requested === 'retry')
    return 'retry' as const;
  return 'status' as const;
}

async function failChild(
  store: RestaurantProvisioningStore,
  code: 'sanity' | 'astro',
  child: SanityProvisioningJob | AstroProvisioningJob,
) {
  return store.fail({
    code,
    retryable: child.status === 'failed' && child.retryable,
    manualReview: child.status === 'manual_review',
  });
}

export async function runRestaurantProvisioning(
  claim: RestaurantProvisioningClaim,
  requested: 'start' | 'retry' | 'status' | 'verify_sanity_admin',
  dependencies: {
    children: ChildProvisioningClient;
    assignment: ClientAssignment;
    store: RestaurantProvisioningStore;
    readiness: { sanity: boolean; astro: boolean; invitations: boolean };
  },
) {
  if (!claim.execute) return claim.job;
  let job = claim.job;
  try {
    if (job.stage === 'sanity') {
      if (!dependencies.readiness.sanity)
        throw new RestaurantProvisioningStepError('configuration', true);
      const sanity = await dependencies.children.sanity(
        sanityChildOperation(job.sanity, requested),
        job,
      );
      if (sanity.status === 'manual_review' || sanity.status === 'failed')
        return failChild(dependencies.store, 'sanity', sanity);
      if (sanity.status !== 'succeeded') return dependencies.store.wait();
      job = await dependencies.store.checkpoint('astro', {
        restaurantId: sanity.restaurant_id,
        integrationId: sanity.integration_id,
      });
    }

    if (job.stage === 'astro') {
      if (!dependencies.readiness.astro)
        throw new RestaurantProvisioningStepError('configuration', true);
      const astro = await dependencies.children.astro(
        childOperation(job.astro?.status, job.astro?.retryable, requested),
        job,
      );
      if (astro.status === 'manual_review' || astro.status === 'failed')
        return failChild(dependencies.store, 'astro', astro);
      if (astro.status !== 'succeeded') return dependencies.store.wait();
      job = await dependencies.store.checkpoint('client_invitation', {
        repository: astro.repository,
        siteUrl: astro.site_url,
      });
    }

    if (job.stage === 'client_invitation') {
      if (!dependencies.readiness.invitations)
        throw new RestaurantProvisioningStepError('configuration', true);
      job = await dependencies.store.prepareInvitation();
      const userId = job.client_user_id
        ? job.client_user_id
        : (await dependencies.assignment.ensure(job.client_email)).userId;
      return dependencies.store.complete(userId);
    }
    return job;
  } catch (error) {
    if (error instanceof RestaurantProvisioningStepError)
      return dependencies.store.fail({
        code: error.code,
        retryable: error.retryable,
        manualReview: error.manualReview,
      });
    return dependencies.store.fail({ code: 'database', retryable: true, manualReview: false });
  }
}
