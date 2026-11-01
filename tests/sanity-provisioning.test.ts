// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  sanityProvisioningRequest,
  type SanityProvisioningErrorCode,
  type SanityProvisioningJob,
} from '../shared/sanity-provisioning';
import { provisioningIdentity } from '../supabase/functions/_shared/provisioning-request';
import {
  runSanityProvisioning,
  type ProvisioningClaim,
  type ProvisioningStore,
} from '../supabase/functions/_shared/sanity-provisioning-service';
import {
  sanityManagement,
  SanityManagementError,
  sanityProvisioningConfiguration,
  type SanityManagement,
} from '../supabase/functions/_shared/sanity-management';

const job: SanityProvisioningJob = {
  request_id: '00000000-0000-4000-8000-000000000001',
  restaurant_id: '00000000-0000-4000-8000-000000000002',
  integration_id: '00000000-0000-4000-8000-000000000003',
  name: 'Restaurant Test',
  slug: 'restaurant-test',
  project_id: 'r1234567890abcde',
  dataset: 'production',
  status: 'running',
  stage: 'queued',
  attempt_count: 1,
  retryable: false,
  error_code: null,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};
const claim = (overrides: Partial<ProvisioningClaim> = {}): ProvisioningClaim => ({
  execute: true,
  leaseToken: '00000000-0000-4000-8000-000000000004',
  job,
  ...overrides,
});

function store() {
  const checkpoints: string[] = [];
  const failures: unknown[] = [];
  const completed = { ...job, status: 'succeeded', stage: 'completed' } as SanityProvisioningJob;
  const api: ProvisioningStore = {
    checkpoint: vi.fn(async (stage) => {
      checkpoints.push(stage);
    }),
    complete: vi.fn(async () => completed),
    fail: vi.fn(
      async (input: {
        code: SanityProvisioningErrorCode;
        retryable: boolean;
        manualReview: boolean;
      }): Promise<SanityProvisioningJob> => {
        failures.push(input);
        return {
          ...job,
          status: input.manualReview ? 'manual_review' : 'failed',
          retryable: input.retryable,
          error_code: input.code,
        };
      },
    ),
  };
  return { api, checkpoints, failures, completed };
}

function provider(overrides: Partial<SanityManagement> = {}): SanityManagement {
  return {
    organizationId: 'org-test',
    getProject: vi.fn(async () => null),
    createProject: vi.fn(async (id, displayName) => ({
      id,
      displayName,
      organizationId: 'org-test',
    })),
    listDatasets: vi.fn(async () => []),
    createDataset: vi.fn(async (_id, name) => ({ datasetName: name, aclMode: 'public' })),
    listTokens: vi.fn(async () => []),
    createEditorToken: vi.fn(async () => ({ id: 'token-id', label: 'label', key: 'token-key' })),
    ...overrides,
  };
}

describe('servicio de aprovisionamiento Sanity', () => {
  it('acepta solo la fase Sanity y rechaza campos futuros o credenciales del navegador', () => {
    const base = {
      operation: 'start',
      payload: {
        request_id: job.request_id,
        name: job.name,
        slug: job.slug,
        dataset: 'production',
      },
    };
    expect(sanityProvisioningRequest.safeParse(base).success).toBe(true);
    for (const extra of [
      { token: 'browser-secret' },
      { client_email: 'client@example.com' },
      { template_key: 'restaurant-editorial' },
      { custom_domain: 'example.com' },
    ])
      expect(
        sanityProvisioningRequest.safeParse({
          ...base,
          payload: { ...base.payload, ...extra },
        }).success,
      ).toBe(false);
  });

  it('crea cada recurso una vez, cifra el token y completa la integración', async () => {
    const db = store();
    const sanity = provider();
    const encrypt = vi.fn(async () => ({ ciphertext: 'cipher', iv: 'nonce', key_version: 'v1' }));
    const result = await runSanityProvisioning(claim(), { sanity, store: db.api, encrypt });
    expect(result).toBe(db.completed);
    expect(db.checkpoints).toEqual(['project_ready', 'dataset_ready', 'credential_pending']);
    expect(sanity.createProject).toHaveBeenCalledOnce();
    expect(sanity.createDataset).toHaveBeenCalledOnce();
    expect(sanity.createEditorToken).toHaveBeenCalledOnce();
    expect(encrypt).toHaveBeenCalledWith('token-key', job.integration_id);
    expect(db.failures).toEqual([]);
  });

  it('reanuda desde recursos verificados y no duplica proyecto o dataset', async () => {
    const db = store();
    const sanity = provider({
      getProject: vi.fn(async () => ({
        id: job.project_id,
        displayName: job.name,
        organizationId: 'org-test',
      })),
      listDatasets: vi.fn(async () => [{ name: 'production', aclMode: 'public' }]),
    });
    await runSanityProvisioning(claim(), {
      sanity,
      store: db.api,
      encrypt: async () => ({ ciphertext: 'cipher', iv: 'nonce', key_version: 'v1' }),
    });
    expect(sanity.createProject).not.toHaveBeenCalled();
    expect(sanity.createDataset).not.toHaveBeenCalled();
  });

  it('una ejecución duplicada devuelve el mismo trabajo sin llamadas externas', async () => {
    const sanity = provider();
    const db = store();
    const existing = { ...job, status: 'succeeded', stage: 'completed' } as SanityProvisioningJob;
    const result = await runSanityProvisioning(
      claim({ execute: false, leaseToken: null, job: existing }),
      {
        sanity,
        store: db.api,
        encrypt: vi.fn(),
      },
    );
    expect(result).toBe(existing);
    expect(sanity.getProject).not.toHaveBeenCalled();
  });

  it('un token existente o una respuesta incierta exige revisión manual y no reintenta', async () => {
    for (const sanity of [
      provider({
        listTokens: vi.fn(async () => [
          { id: 'existing', label: `restaurant-platform-${job.integration_id}` },
        ]),
      }),
      provider({
        createEditorToken: vi.fn(async () => {
          throw new SanityManagementError('credential_ambiguous', false, true);
        }),
      }),
    ]) {
      const db = store();
      const result = await runSanityProvisioning(claim(), {
        sanity,
        store: db.api,
        encrypt: vi.fn(),
      });
      expect(result).toMatchObject({ status: 'manual_review', retryable: false });
      expect(db.failures).toEqual([
        { code: 'credential_ambiguous', retryable: false, manualReview: true },
      ]);
    }
  });

  it('clasifica fallos conocidos sin respuestas privadas y solo permite reintento explícito', async () => {
    const db = store();
    const result = await runSanityProvisioning(claim(), {
      sanity: provider({
        getProject: vi.fn(async () => {
          throw new SanityManagementError('permissions', true);
        }),
      }),
      store: db.api,
      encrypt: vi.fn(),
    });
    expect(result).toMatchObject({ status: 'failed', retryable: true, error_code: 'permissions' });
  });

  it('genera identidad estable y exige secretos backend sin revelar valores', async () => {
    const input = {
      request_id: job.request_id,
      name: job.name,
      slug: job.slug,
      dataset: 'production' as const,
    };
    expect(await provisioningIdentity(input)).toEqual(await provisioningIdentity(input));
    expect((await provisioningIdentity(input)).projectId).toMatch(/^r[a-f0-9]{15}$/);
    const secret = 'private-management-token';
    expect(() =>
      sanityProvisioningConfiguration((name) =>
        name === 'SANITY_PROVISIONER_TOKEN' ? secret : undefined,
      ),
    ).toThrow(/Organización de Sanity/);
  });

  it('cliente HTTP usa endpoints oficiales y nunca incorpora el token al cuerpo', async () => {
    const requests: Request[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === 'POST')
        return Response.json(
          { id: job.project_id, displayName: job.name, organizationId: 'org-test' },
          { status: 201 },
        );
      return new Response(null, { status: 404 });
    });
    const client = sanityManagement(
      { token: 'management-secret', organizationId: 'org-test' },
      fetcher as typeof fetch,
    );
    await client.createProject(job.project_id, job.name);
    expect(requests[0].url).toBe('https://api.sanity.io/v2021-06-07/projects');
    expect(await requests[0].clone().text()).not.toContain('management-secret');
    expect(requests[0].headers.get('authorization')).toBe('Bearer management-secret');
  });

  it('sanitiza rechazos del proveedor sin propagar la respuesta privada', async () => {
    const privateBody = 'provider-private-diagnostic';
    const client = sanityManagement(
      { token: 'management-secret', organizationId: 'org-test' },
      vi.fn(async () => new Response(privateBody, { status: 403 })) as typeof fetch,
    );
    await expect(client.getProject(job.project_id)).rejects.toMatchObject({
      code: 'permissions',
      message: 'Sanity management request failed',
    });
    await expect(client.getProject(job.project_id)).rejects.not.toThrow(privateBody);
  });
});
