// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  restaurantProvisioningRequest,
  type RestaurantProvisioningJob,
} from '../shared/restaurant-provisioning';
import { restaurantProvisioningIdentity } from '../supabase/functions/_shared/restaurant-provisioning-request';
import {
  runRestaurantProvisioning,
  type RestaurantProvisioningStore,
} from '../supabase/functions/_shared/restaurant-provisioning-service';

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const release = {
  template_key: 'restaurant-editorial',
  version: '0.4.0',
  source_commit: 'a'.repeat(40),
  distribution_hash: 'b'.repeat(64),
  configuration_contract: 1 as const,
  content_contract: 'salitre-v1' as const,
  visual_contract: 2 as const,
};
const job: RestaurantProvisioningJob = {
  request_id: id('1'),
  name: 'Burger House',
  slug: 'burger-house',
  client_email: 'client@example.com',
  client_role: 'restaurant_owner',
  template: { template_key: release.template_key, version: release.version },
  visual: { preset: 'casual' },
  modules: [{ key: 'content_management', granted: true, enabled: true }],
  domain: { hostname: 'www.burger-house.example', mode: 'subdomain' },
  sanity_request_id: id('2'),
  astro_request_id: id('3'),
  restaurant_id: null,
  integration_id: null,
  invitation_id: null,
  client_user_id: null,
  repository: null,
  site_url: null,
  status: 'running',
  stage: 'sanity',
  attempt_count: 1,
  retryable: false,
  error_code: null,
  sanity: null,
  astro: null,
  dns: null,
  created_at: '2026-11-02T00:00:00.000Z',
  updated_at: '2026-11-02T00:00:00.000Z',
};
const sanity = {
  request_id: job.sanity_request_id,
  restaurant_id: id('4'),
  integration_id: id('5'),
  name: job.name,
  slug: job.slug,
  project_key: 'r1234567890abcde',
  project_id: 'r1234567890abcde',
  manage_url: 'https://www.sanity.io/manage/project/r1234567890abcde',
  dataset: 'production' as const,
  status: 'succeeded' as const,
  stage: 'completed' as const,
  attempt_count: 1,
  retryable: false,
  error_code: null,
  created_at: job.created_at,
  updated_at: job.updated_at,
};
const astro = {
  request_id: job.astro_request_id,
  sanity_request_id: job.sanity_request_id,
  restaurant_id: sanity.restaurant_id,
  integration_id: sanity.integration_id,
  name: job.name,
  slug: job.slug,
  project_id: sanity.project_id,
  dataset: sanity.dataset,
  template: release,
  visual: job.visual,
  modules: job.modules,
  custom_domain: job.domain!.hostname,
  repository: 'owner/burger-house-restaurant',
  repository_id: '123',
  site_url: 'https://owner.github.io/burger-house-restaurant/',
  base_path: '/burger-house-restaurant',
  specification_hash: 'c'.repeat(64),
  source_commit: null,
  manifest_hash: null,
  deployment_id: null,
  status: 'running' as const,
  stage: 'initialization_dispatched' as const,
  attempt_count: 1,
  retryable: false,
  error_code: null,
  created_at: job.created_at,
  updated_at: job.updated_at,
};

function store(current = job) {
  let value = current;
  const api: RestaurantProvisioningStore = {
    checkpoint: vi.fn(async (stage, evidence) => {
      value = {
        ...value,
        stage,
        restaurant_id: evidence?.restaurantId || value.restaurant_id,
        integration_id: evidence?.integrationId || value.integration_id,
        repository: evidence?.repository || value.repository,
        site_url: evidence?.siteUrl || value.site_url,
      };
      return value;
    }),
    wait: vi.fn(async () => ({ ...value, status: 'awaiting' as const })),
    prepareInvitation: vi.fn(async () => value),
    complete: vi.fn(async (userId) => ({
      ...value,
      client_user_id: userId,
      status: 'succeeded' as const,
      stage: 'completed' as const,
    })),
    fail: vi.fn(async ({ code, retryable, manualReview }) => ({
      ...value,
      status: manualReview ? ('manual_review' as const) : ('failed' as const),
      error_code: code,
      retryable,
    })),
  };
  return api;
}

describe('complete restaurant provisioning', () => {
  it('accepts business choices only and derives stable child request identities', async () => {
    const input = {
      operation: 'start' as const,
      payload: {
        request_id: job.request_id,
        name: job.name,
        slug: job.slug,
        client_email: job.client_email,
        client_role: job.client_role,
        template: job.template,
        visual: job.visual,
        modules: job.modules,
        domain: job.domain!,
      },
    };
    expect(restaurantProvisioningRequest.safeParse(input).success).toBe(true);
    for (const field of ['project_id', 'repository', 'token', 'script'])
      expect(
        restaurantProvisioningRequest.safeParse({
          ...input,
          payload: { ...input.payload, [field]: 'attacker-controlled' },
        }).success,
      ).toBe(false);
    const first = await restaurantProvisioningIdentity(input.payload);
    const second = await restaurantProvisioningIdentity(input.payload);
    expect(first).toEqual(second);
    expect(first.sanityRequestId).not.toBe(first.astroRequestId);
    expect(first.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('stops before provider calls when required backend configuration is absent', async () => {
    const database = store();
    const children = { sanity: vi.fn(), astro: vi.fn() };
    const result = await runRestaurantProvisioning(
      { execute: true, leaseToken: id('9'), job },
      'start',
      {
        children,
        assignment: { ensure: vi.fn() },
        store: database,
        readiness: { sanity: false, astro: false, invitations: false },
      },
    );
    expect(result).toMatchObject({
      status: 'failed',
      error_code: 'configuration',
      retryable: true,
    });
    expect(children.sanity).not.toHaveBeenCalled();
  });

  it('coordinates Sanity once, then waits for the OIDC Astro callback without inviting early', async () => {
    const database = store();
    const assignment = { ensure: vi.fn() };
    const result = await runRestaurantProvisioning(
      { execute: true, leaseToken: id('9'), job },
      'start',
      {
        children: { sanity: vi.fn(async () => sanity), astro: vi.fn(async () => astro) },
        assignment,
        store: database,
        readiness: { sanity: true, astro: true, invitations: true },
      },
    );
    expect(result).toMatchObject({ status: 'awaiting', stage: 'astro' });
    expect(database.checkpoint).toHaveBeenCalledWith('astro', {
      restaurantId: sanity.restaurant_id,
      integrationId: sanity.integration_id,
    });
    expect(assignment.ensure).not.toHaveBeenCalled();
  });

  it('keeps the aggregate paused and only verifies the expected Sanity admin on explicit action', async () => {
    const waitingSanity = {
      ...sanity,
      status: 'awaiting' as const,
      stage: 'awaiting_sanity_admin' as const,
    };
    const waiting = { ...job, status: 'awaiting' as const, sanity: waitingSanity };
    const database = store(waiting);
    const sanityCall = vi.fn(async () => waitingSanity);
    const result = await runRestaurantProvisioning(
      { execute: true, leaseToken: id('9'), job: waiting },
      'verify_sanity_admin',
      {
        children: { sanity: sanityCall, astro: vi.fn() },
        assignment: { ensure: vi.fn() },
        store: database,
        readiness: { sanity: true, astro: true, invitations: true },
      },
    );
    expect(sanityCall).toHaveBeenCalledWith('verify_admin', waiting);
    expect(result).toMatchObject({ status: 'awaiting', stage: 'sanity' });
  });

  it('finishes an OIDC-confirmed website and reuses a known client without another invitation', async () => {
    const ready: RestaurantProvisioningJob = {
      ...job,
      stage: 'astro',
      restaurant_id: sanity.restaurant_id,
      integration_id: sanity.integration_id,
      sanity,
      astro: { ...astro, status: 'succeeded', stage: 'completed', deployment_id: id('8') },
      client_user_id: id('7'),
    };
    const database = store(ready);
    vi.mocked(database.prepareInvitation).mockImplementation(async () => ({
      ...ready,
      stage: 'client_invitation',
      repository: astro.repository,
      site_url: astro.site_url,
    }));
    const assignment = { ensure: vi.fn() };
    const result = await runRestaurantProvisioning(
      { execute: true, leaseToken: id('9'), job: ready },
      'status',
      {
        children: {
          sanity: vi.fn(),
          astro: vi.fn(async () => ({
            ...astro,
            status: 'succeeded' as const,
            stage: 'completed' as const,
            deployment_id: id('8'),
          })),
        },
        assignment,
        store: database,
        readiness: { sanity: true, astro: true, invitations: true },
      },
    );
    expect(result).toMatchObject({ status: 'succeeded', stage: 'completed' });
    expect(assignment.ensure).not.toHaveBeenCalled();
    expect(database.complete).toHaveBeenCalledWith(id('7'));
  });

  it('never retries a failed child unless the aggregate retry is explicit', async () => {
    const failed = {
      ...job,
      sanity: {
        ...sanity,
        status: 'failed' as const,
        stage: 'project_ready' as const,
        retryable: true,
        error_code: 'connection' as const,
      },
    };
    const database = store(failed);
    const sanityCall = vi.fn(async () => sanity);
    await runRestaurantProvisioning({ execute: true, leaseToken: id('9'), job: failed }, 'status', {
      children: { sanity: sanityCall, astro: vi.fn(async () => astro) },
      assignment: { ensure: vi.fn() },
      store: database,
      readiness: { sanity: true, astro: true, invitations: true },
    });
    expect(sanityCall).toHaveBeenCalledWith('status', failed);
  });
});
