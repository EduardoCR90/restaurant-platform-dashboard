// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  astroProvisioningRequest,
  type AstroProvisioningErrorCode,
  type AstroProvisioningJob,
} from '../shared/astro-provisioning';
import {
  githubManagement,
  githubProvisioningConfiguration,
  GithubManagementError,
  type GithubManagement,
} from '../supabase/functions/_shared/github-management';
import {
  runAstroProvisioning,
  verifyProvisionedSource,
  type AstroProvisioningClaim,
  type AstroProvisioningStore,
} from '../supabase/functions/_shared/astro-provisioning-service';
import {
  encodedSpecification,
  instanceSpec,
} from '../supabase/functions/_shared/astro-provisioning-request';

const job: AstroProvisioningJob = {
  request_id: '00000000-0000-4000-8000-000000000001',
  sanity_request_id: '00000000-0000-4000-8000-000000000002',
  restaurant_id: '00000000-0000-4000-8000-000000000003',
  integration_id: '00000000-0000-4000-8000-000000000004',
  name: 'Restaurant Test',
  slug: 'restaurant-test',
  project_id: 'r1234567890abcde',
  dataset: 'production',
  template: {
    template_key: 'restaurant-editorial',
    version: '0.4.0',
    source_commit: 'a'.repeat(40),
    distribution_hash: 'b'.repeat(64),
    configuration_contract: 1,
    content_contract: 'salitre-v1',
    visual_contract: 2,
  },
  visual: { preset: 'elegant' },
  modules: [{ key: 'content_management', granted: true, enabled: true }],
  custom_domain: null,
  repository: 'owner/restaurant-test-restaurant',
  repository_id: null,
  site_url: 'https://owner.github.io/restaurant-test-restaurant/',
  base_path: '/restaurant-test-restaurant',
  specification_hash: null,
  source_commit: null,
  manifest_hash: null,
  deployment_id: null,
  status: 'running',
  stage: 'queued',
  attempt_count: 1,
  retryable: false,
  error_code: null,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};
const endpoints = {
  publication: 'https://platform.example/functions/v1/publications',
  provisioning: 'https://platform.example/functions/v1/astro-provisioning',
};
const claim = (value = job): AstroProvisioningClaim => ({
  execute: true,
  leaseToken: '00000000-0000-4000-8000-000000000005',
  job: value,
});

function provider(overrides: Partial<GithubManagement> = {}): GithubManagement {
  const template = {
    id: '100',
    fullName: 'owner/template',
    private: true,
    defaultBranch: 'main',
    owner: 'owner',
    isTemplate: true,
    templateRepositoryId: null,
  };
  return {
    owner: 'owner',
    visibility: 'private',
    templateRepository: 'owner/template',
    templateRepositoryId: '100',
    workflow: 'bootstrap-instance.yml',
    getRepository: vi.fn(async (name) => (name === 'owner/template' ? template : null)),
    getHead: vi.fn(async () => job.template.source_commit),
    generateRepository: vi.fn(async () => ({
      id: '200',
      fullName: job.repository,
      private: true,
      defaultBranch: 'main',
      owner: 'owner',
      isTemplate: false,
      templateRepositoryId: '100',
    })),
    dispatch: vi.fn(async () => undefined),
    readFile: vi.fn(),
    enablePages: vi.fn(async () => ({ url: job.site_url })),
    ...overrides,
  };
}

function store() {
  let current = job;
  const failures: unknown[] = [];
  const api: AstroProvisioningStore = {
    checkpoint: vi.fn(async (stage, evidence) => {
      current = {
        ...current,
        stage,
        repository_id: evidence?.repositoryId || current.repository_id,
        specification_hash: evidence?.specificationHash || current.specification_hash,
      };
      return current;
    }),
    awaitCallback: vi.fn(async () => {
      current = { ...current, stage: 'initialization_dispatched' };
      return current;
    }),
    complete: vi.fn(async () => {
      current = { ...current, status: 'succeeded', stage: 'completed' };
      return current;
    }),
    fail: vi.fn(
      async (input: {
        code: AstroProvisioningErrorCode;
        retryable: boolean;
        manualReview: boolean;
      }) => {
        failures.push(input);
        current = {
          ...current,
          status: input.manualReview ? 'manual_review' : 'failed',
          retryable: input.retryable,
          error_code: input.code,
        };
        return current;
      },
    ),
  };
  return { api, failures, current: () => current };
}

describe('Astro instance provisioning', () => {
  it('accepts only a Super Admin plan payload and rejects repository IDs, tokens or scripts', () => {
    const base = {
      operation: 'start',
      payload: {
        request_id: job.request_id,
        sanity_request_id: job.sanity_request_id,
        template: { template_key: 'restaurant-editorial', version: '0.4.0' },
        visual: { preset: 'elegant' },
        modules: job.modules,
      },
    };
    expect(astroProvisioningRequest.safeParse(base).success).toBe(true);
    for (const extra of [
      { repository: 'attacker/repo' },
      { github_token: 'secret' },
      { command: 'curl attacker' },
      { project_id: 'other' },
    ])
      expect(
        astroProvisioningRequest.safeParse({
          ...base,
          payload: { ...base.payload, ...extra },
        }).success,
      ).toBe(false);
  });

  it('creates the repository once and dispatches the exact hashed public specification', async () => {
    const github = provider();
    const database = store();
    const result = await runAstroProvisioning(claim(), {
      github,
      store: database.api,
      endpoints,
    });
    expect(result.stage).toBe('initialization_dispatched');
    expect(github.generateRepository).toHaveBeenCalledOnce();
    expect(github.dispatch).toHaveBeenCalledOnce();
    const inputs = vi.mocked(github.dispatch).mock.calls[0][1];
    expect(inputs.request_id).toBe(job.request_id);
    expect(inputs.specification_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(inputs.specification_b64, 'base64url').toString()).not.toContain('token');
    expect(database.failures).toEqual([]);
  });

  it('accepts missing template metadata only in the successful generation response', async () => {
    const observeRepositoryValidation = vi.fn();
    const github = provider({
      generateRepository: vi.fn(async () => ({
        id: '200',
        fullName: job.repository,
        private: true,
        defaultBranch: 'main',
        owner: 'owner',
        isTemplate: false,
        templateRepositoryId: null,
      })),
    });
    const database = store();
    const result = await runAstroProvisioning(claim(), {
      github,
      store: database.api,
      endpoints,
      observeRepositoryValidation,
    });
    expect(result.stage).toBe('initialization_dispatched');
    expect(observeRepositoryValidation).toHaveBeenCalledWith({
      source: 'generated',
      outcome: 'accepted',
      issues: [],
      provenance: 'generation_response',
    });
  });

  it('recovers an existing generated repository only with exact template provenance', async () => {
    const target = {
      id: '200',
      fullName: job.repository,
      private: true,
      defaultBranch: 'main',
      owner: 'owner',
      isTemplate: false,
      templateRepositoryId: '100',
    };
    const github = provider({
      getRepository: vi.fn(async (name) =>
        name === 'owner/template'
          ? {
              id: '100',
              fullName: 'owner/template',
              private: true,
              defaultBranch: 'main',
              owner: 'owner',
              isTemplate: true,
              templateRepositoryId: null,
            }
          : target,
      ),
    });
    const database = store();
    const observeRepositoryValidation = vi.fn();
    const result = await runAstroProvisioning(claim(), {
      github,
      store: database.api,
      endpoints,
      observeRepositoryValidation,
    });
    expect(result).toMatchObject({ stage: 'initialization_dispatched', repository_id: '200' });
    expect(github.generateRepository).not.toHaveBeenCalled();
    expect(observeRepositoryValidation).toHaveBeenCalledWith({
      source: 'existing',
      outcome: 'accepted',
      issues: [],
      provenance: 'matched',
    });
  });

  it('recovers an ambiguous create response only after GitHub proves template provenance', async () => {
    const target = {
      id: '200',
      fullName: job.repository,
      private: true,
      defaultBranch: 'main',
      owner: 'owner',
      isTemplate: false,
      templateRepositoryId: '100',
    };
    let targetReads = 0;
    const github = provider({
      getRepository: vi.fn(async (name) => {
        if (name === 'owner/template')
          return {
            id: '100',
            fullName: 'owner/template',
            private: true,
            defaultBranch: 'main',
            owner: 'owner',
            isTemplate: true,
            templateRepositoryId: null,
          };
        targetReads += 1;
        return targetReads === 1 ? null : target;
      }),
      generateRepository: vi.fn(async () => {
        throw new GithubManagementError('connection', true, true);
      }),
    });
    const database = store();
    const observeRepositoryValidation = vi.fn();
    const result = await runAstroProvisioning(claim(), {
      github,
      store: database.api,
      endpoints,
      observeRepositoryValidation,
    });
    expect(result.stage).toBe('initialization_dispatched');
    expect(github.generateRepository).toHaveBeenCalledOnce();
    expect(observeRepositoryValidation).toHaveBeenCalledWith({
      source: 'ambiguous_write_recovery',
      outcome: 'accepted',
      issues: [],
      provenance: 'matched',
    });
  });

  it('does not adopt an ambiguous create result without template evidence', async () => {
    let targetReads = 0;
    const github = provider({
      getRepository: vi.fn(async (name) => {
        if (name === 'owner/template')
          return {
            id: '100',
            fullName: 'owner/template',
            private: true,
            defaultBranch: 'main',
            owner: 'owner',
            isTemplate: true,
            templateRepositoryId: null,
          };
        targetReads += 1;
        return targetReads === 1
          ? null
          : {
              id: '200',
              fullName: job.repository,
              private: true,
              defaultBranch: 'main',
              owner: 'owner',
              isTemplate: false,
              templateRepositoryId: null,
            };
      }),
      generateRepository: vi.fn(async () => {
        throw new GithubManagementError('connection', true, true);
      }),
    });
    const database = store();
    const observeRepositoryValidation = vi.fn();
    const result = await runAstroProvisioning(claim(), {
      github,
      store: database.api,
      endpoints,
      observeRepositoryValidation,
    });
    expect(result).toMatchObject({ status: 'manual_review', error_code: 'repository_conflict' });
    expect(observeRepositoryValidation).toHaveBeenCalledWith({
      source: 'ambiguous_write_recovery',
      outcome: 'rejected',
      issues: ['template_provenance'],
      provenance: 'missing',
    });
    expect(github.dispatch).not.toHaveBeenCalled();
  });

  it('resumes Pages only after the OIDC-confirmed source stage', async () => {
    const database = store();
    const ready: AstroProvisioningJob = {
      ...job,
      repository_id: '200',
      specification_hash: null,
      source_commit: 'd'.repeat(40),
      manifest_hash: 'e'.repeat(64),
      stage: 'source_ready' as const,
    };
    ready.specification_hash = (await encodedSpecification(instanceSpec(ready, endpoints))).hash;
    const github = provider();
    const result = await runAstroProvisioning(claim(ready), {
      github,
      store: database.api,
      endpoints,
    });
    expect(github.enablePages).toHaveBeenCalledWith(job.repository);
    expect(result).toMatchObject({ status: 'succeeded', stage: 'completed' });
    expect(github.generateRepository).not.toHaveBeenCalled();
  });

  it('stops incompatible repositories and ambiguous writes for manual review', async () => {
    const database = store();
    const github = provider({
      getRepository: vi.fn(async (name) =>
        name === 'owner/template'
          ? {
              id: '100',
              fullName: 'owner/template',
              private: true,
              defaultBranch: 'main',
              owner: 'owner',
              isTemplate: true,
              templateRepositoryId: null,
            }
          : {
              id: '999',
              fullName: job.repository,
              private: true,
              defaultBranch: 'main',
              owner: 'owner',
              isTemplate: false,
              templateRepositoryId: null,
            },
      ),
    });
    const observeRepositoryValidation = vi.fn();
    const result = await runAstroProvisioning(claim(), {
      github,
      store: database.api,
      endpoints,
      observeRepositoryValidation,
    });
    expect(result).toMatchObject({ status: 'manual_review', error_code: 'repository_conflict' });
    expect(github.generateRepository).not.toHaveBeenCalled();
    expect(observeRepositoryValidation).toHaveBeenCalledWith({
      source: 'existing',
      outcome: 'rejected',
      issues: ['template_provenance'],
      provenance: 'missing',
    });
  });

  it.each([
    ['name', { fullName: 'owner/other-repository' }, ['repository_name']],
    ['default branch', { defaultBranch: 'develop' }, ['default_branch']],
    ['visibility', { private: false }, ['visibility']],
    ['owner', { owner: 'attacker' }, ['repository_owner']],
    ['template', { templateRepositoryId: '999' }, ['template_provenance']],
  ])('diagnoses a repository conflict caused by %s', async (_label, override, issues) => {
    const target = {
      id: '200',
      fullName: job.repository,
      private: true,
      defaultBranch: 'main',
      owner: 'owner',
      isTemplate: false,
      templateRepositoryId: '100',
      ...override,
    };
    const github = provider({
      getRepository: vi.fn(async (name) =>
        name === 'owner/template'
          ? {
              id: '100',
              fullName: 'owner/template',
              private: true,
              defaultBranch: 'main',
              owner: 'owner',
              isTemplate: true,
              templateRepositoryId: null,
            }
          : target,
      ),
    });
    const database = store();
    const observeRepositoryValidation = vi.fn();
    await runAstroProvisioning(claim(), {
      github,
      store: database.api,
      endpoints,
      observeRepositoryValidation,
    });
    expect(observeRepositoryValidation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'rejected', issues }),
    );
    expect(github.dispatch).not.toHaveBeenCalled();
  });

  it('verifies the manifest at the reported commit before Pages registration', async () => {
    const configured = {
      ...job,
      repository_id: '200',
      stage: 'initialization_dispatched' as const,
    };
    const specification = await encodedSpecification(instanceSpec(configured, endpoints));
    configured.specification_hash = specification.hash;
    const manifest = {
      format: 1,
      request_id: job.request_id,
      specification_hash: specification.hash,
      configuration_hash: 'f'.repeat(64),
      repository: job.repository,
      template: job.template,
      sanity: { project_id: job.project_id, dataset: job.dataset },
      deployment: {
        publication_endpoint: endpoints.publication,
        provisioning_endpoint: endpoints.provisioning,
      },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const manifestHash = [...new Uint8Array(hash)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    const github = provider({ readFile: vi.fn(async () => bytes) });
    await expect(
      verifyProvisionedSource(configured, { sourceCommit: 'd'.repeat(40), manifestHash }, github),
    ).resolves.toEqual({ sourceCommit: 'd'.repeat(40), manifestHash });
    await expect(
      verifyProvisionedSource(
        configured,
        { sourceCommit: 'd'.repeat(40), manifestHash: '0'.repeat(64) },
        github,
      ),
    ).rejects.toMatchObject({ code: 'manifest', ambiguous: true });
  });

  it('uses GitHub REST with backend credentials only and sanitizes provider errors', async () => {
    const secret = 'github-backend-secret-value';
    const configuration = githubProvisioningConfiguration(
      (name) =>
        ({
          GITHUB_PROVISIONER_TOKEN: secret,
          GITHUB_REPOSITORY_OWNER: 'owner',
          GITHUB_TEMPLATE_REPOSITORY: 'owner/template',
          GITHUB_TEMPLATE_REPOSITORY_ID: '100',
        })[name],
    );
    const requests: Request[] = [];
    const client = githubManagement(
      configuration,
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({ message: 'private provider diagnostic' }, { status: 403 });
      }) as typeof fetch,
    );
    await expect(client.getRepository('owner/template')).rejects.toMatchObject({
      code: 'permissions',
    });
    expect(await requests[0].clone().text()).not.toContain(secret);
    expect(requests[0].headers.get('authorization')).toBe(`Bearer ${secret}`);
    await expect(client.getRepository('owner/template')).rejects.not.toThrow(
      'private provider diagnostic',
    );
    const missing = githubManagement(
      configuration,
      vi.fn(async () => Response.json({ message: 'Not Found' }, { status: 404 })) as typeof fetch,
    );
    await expect(missing.getRepository('owner/not-created')).resolves.toBeNull();
  });

  it('rejects an incomplete GitHub repository response without adopting it', async () => {
    const configuration = githubProvisioningConfiguration(
      (name) =>
        ({
          GITHUB_PROVISIONER_TOKEN: 'github-backend-secret-value',
          GITHUB_REPOSITORY_OWNER: 'owner',
          GITHUB_TEMPLATE_REPOSITORY: 'owner/template',
          GITHUB_TEMPLATE_REPOSITORY_ID: '100',
        })[name],
    );
    const client = githubManagement(
      configuration,
      vi.fn(async () =>
        Response.json({
          id: 200,
          full_name: job.repository,
          private: true,
          owner: { login: 'owner' },
          // GitHub has not exposed a default branch yet.
        }),
      ) as typeof fetch,
    );
    await expect(client.getRepository(job.repository)).rejects.toMatchObject({
      code: 'provider_response',
      retryable: false,
      ambiguous: true,
    });
  });

  it('checkpoints a generated repository before a partial initialization failure', async () => {
    const database = store();
    const github = provider({
      generateRepository: vi.fn(async () => ({
        id: '200',
        fullName: job.repository,
        private: true,
        defaultBranch: 'main',
        owner: 'owner',
        isTemplate: false,
        templateRepositoryId: null,
      })),
      dispatch: vi.fn(async () => {
        throw new GithubManagementError('dispatch', true);
      }),
    });
    const result = await runAstroProvisioning(claim(), {
      github,
      store: database.api,
      endpoints,
    });
    expect(result).toMatchObject({
      repository_id: '200',
      stage: 'repository_created',
      status: 'failed',
      retryable: true,
      error_code: 'dispatch',
    });
    expect(database.api.checkpoint).toHaveBeenCalledOnce();
  });

  it('does not auto-retry a dispatch failure', async () => {
    const database = store();
    const configured = {
      ...job,
      repository_id: '200',
      specification_hash: (await encodedSpecification(instanceSpec(job, endpoints))).hash,
      stage: 'repository_created' as const,
    };
    const github = provider({
      dispatch: vi.fn(async () => {
        throw new GithubManagementError('dispatch', true);
      }),
    });
    const result = await runAstroProvisioning(claim(configured), {
      github,
      store: database.api,
      endpoints,
    });
    expect(result).toMatchObject({ status: 'failed', retryable: true, error_code: 'dispatch' });
    expect(github.dispatch).toHaveBeenCalledOnce();
  });
});
