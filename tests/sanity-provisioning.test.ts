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

const externalProjectId = 'lvtvr3ef';
const expectedAdministratorId = 'user-platform-owner';
const job: SanityProvisioningJob = {
  request_id: '00000000-0000-4000-8000-000000000001',
  restaurant_id: '00000000-0000-4000-8000-000000000002',
  integration_id: '00000000-0000-4000-8000-000000000003',
  name: 'Restaurant Test',
  slug: 'restaurant-test',
  project_key: 'r1234567890abcde',
  project_id: null,
  manage_url: null,
  dataset: 'production',
  status: 'running',
  stage: 'queued',
  attempt_count: 1,
  retryable: false,
  error_code: null,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
};
const waitingJob: SanityProvisioningJob = {
  ...job,
  project_id: externalProjectId,
  manage_url: `https://www.sanity.io/manage/project/${externalProjectId}`,
  stage: 'awaiting_sanity_admin',
};
const claim = (overrides: Partial<ProvisioningClaim> = {}): ProvisioningClaim => ({
  execute: true,
  leaseToken: '00000000-0000-4000-8000-000000000004',
  job,
  ...overrides,
});

function store(current = job) {
  const checkpoints: string[] = [];
  const failures: unknown[] = [];
  const paused = {
    ...current,
    project_id: externalProjectId,
    manage_url: `https://www.sanity.io/manage/project/${externalProjectId}`,
    status: 'awaiting',
    stage: 'awaiting_sanity_admin',
  } as SanityProvisioningJob;
  const completed = {
    ...waitingJob,
    status: 'succeeded',
    stage: 'completed',
  } as SanityProvisioningJob;
  const api: ProvisioningStore = {
    pauseForAdmin: vi.fn(async (projectId) => ({
      ...paused,
      project_id: projectId,
      manage_url: `https://www.sanity.io/manage/project/${projectId}`,
    })),
    waitForAdmin: vi.fn(async () => ({ ...waitingJob, status: 'awaiting' as const })),
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
          ...current,
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
    expectedAdministratorId,
    getProject: vi.fn(async (_id, includeMembers) => ({
      id: externalProjectId,
      displayName: job.name,
      organizationId: 'org-test',
      ...(includeMembers
        ? {
            members: [
              {
                id: expectedAdministratorId,
                roles: [{ name: 'administrator' }],
                isRobot: false,
              },
            ],
          }
        : {}),
    })),
    createProject: vi.fn(async (displayName) => ({
      id: externalProjectId,
      displayName,
      organizationId: 'org-test',
    })),
    listDatasets: vi.fn(async () => []),
    createDataset: vi.fn(async (_id, name) => ({ datasetName: name, aclMode: 'public' })),
    listTokens: vi.fn(async () => []),
    createDeveloperToken: vi.fn(async () => ({ id: 'token-id', label: 'label', key: 'token-key' })),
    ...overrides,
  };
}

const encryption = async () => ({ ciphertext: 'cipher', iv: 'nonce', key_version: 'v1' });

describe('servicio de aprovisionamiento Sanity híbrido', () => {
  it('acepta solo operaciones cerradas y rechaza credenciales del navegador', () => {
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
    expect(
      sanityProvisioningRequest.safeParse({
        operation: 'verify_admin',
        payload: { request_id: job.request_id },
      }).success,
    ).toBe(true);
    for (const extra of [
      { token: 'secret' },
      { expected_admin: 'attacker' },
      { project_id: 'fake' },
    ])
      expect(
        sanityProvisioningRequest.safeParse({ ...base, payload: { ...base.payload, ...extra } })
          .success,
      ).toBe(false);
  });

  it('persiste el ID real devuelto por Sanity y pausa sin mantener trabajo abierto', async () => {
    const db = store();
    const sanity = provider();
    const result = await runSanityProvisioning(claim(), {
      sanity,
      store: db.api,
      encrypt: encryption,
    });
    expect(result).toMatchObject({
      status: 'awaiting',
      stage: 'awaiting_sanity_admin',
      project_key: job.project_key,
      project_id: externalProjectId,
    });
    expect(sanity.createProject).toHaveBeenCalledWith(job.name);
    expect(db.api.pauseForAdmin).toHaveBeenCalledWith(externalProjectId);
    expect(sanity.createDataset).not.toHaveBeenCalled();
    expect(sanity.createDeveloperToken).not.toHaveBeenCalled();
  });

  it.each([
    ['usuario ausente', []],
    ['usuario incorrecto', [{ id: 'another-user', roles: [{ name: 'administrator' }] }]],
    ['rol insuficiente', [{ id: expectedAdministratorId, roles: [{ name: 'developer' }] }]],
    [
      'identidad robot',
      [{ id: expectedAdministratorId, roles: [{ name: 'administrator' }], isRobot: true }],
    ],
  ])('mantiene la espera cuando falta el administrador esperado: %s', async (_label, members) => {
    const db = store(waitingJob);
    const sanity = provider({
      getProject: vi.fn(async () => ({
        id: externalProjectId,
        displayName: job.name,
        organizationId: 'org-test',
        members,
      })),
    });
    const result = await runSanityProvisioning(claim({ job: waitingJob }), {
      sanity,
      store: db.api,
      encrypt: encryption,
    });
    expect(result).toMatchObject({ status: 'awaiting', stage: 'awaiting_sanity_admin' });
    expect(db.api.waitForAdmin).toHaveBeenCalledOnce();
    expect(sanity.createDataset).not.toHaveBeenCalled();
  });

  it('verifica identidad y rol, reutiliza dataset y continúa con un token Developer', async () => {
    const db = store(waitingJob);
    const sanity = provider({
      listDatasets: vi.fn(async () => [{ name: 'production', aclMode: 'public' }]),
    });
    const encrypt = vi.fn(encryption);
    const result = await runSanityProvisioning(claim({ job: waitingJob }), {
      sanity,
      store: db.api,
      encrypt,
    });
    expect(result).toBe(db.completed);
    expect(db.checkpoints).toEqual(['admin_verified', 'dataset_ready', 'credential_pending']);
    expect(sanity.getProject).toHaveBeenCalledWith(externalProjectId, true);
    expect(sanity.createProject).not.toHaveBeenCalled();
    expect(sanity.createDataset).not.toHaveBeenCalled();
    expect(sanity.createDeveloperToken).toHaveBeenCalledOnce();
    expect(encrypt).toHaveBeenCalledWith('token-key', job.integration_id);
  });

  it('reanuda después de un fallo parcial sin repetir proyecto ni dataset', async () => {
    const credentialJob = { ...waitingJob, stage: 'credential_pending' as const };
    const db = store(credentialJob);
    const sanity = provider();
    await runSanityProvisioning(claim({ job: credentialJob }), {
      sanity,
      store: db.api,
      encrypt: encryption,
    });
    expect(sanity.getProject).not.toHaveBeenCalled();
    expect(sanity.createProject).not.toHaveBeenCalled();
    expect(sanity.createDataset).not.toHaveBeenCalled();
    expect(sanity.createDeveloperToken).toHaveBeenCalledOnce();
  });

  it('una ejecución duplicada no hace llamadas externas', async () => {
    const sanity = provider();
    const existing = {
      ...waitingJob,
      status: 'succeeded',
      stage: 'completed',
    } as SanityProvisioningJob;
    expect(
      await runSanityProvisioning(claim({ execute: false, leaseToken: null, job: existing }), {
        sanity,
        store: store(existing).api,
        encrypt: vi.fn(),
      }),
    ).toBe(existing);
    expect(sanity.getProject).not.toHaveBeenCalled();
  });

  it('un token existente exige revisión manual y nunca crea otro', async () => {
    const credentialJob = { ...waitingJob, stage: 'credential_pending' as const };
    const db = store(credentialJob);
    const sanity = provider({
      listTokens: vi.fn(async () => [
        { id: 'existing', label: `restaurant-platform-${job.integration_id}` },
      ]),
    });
    const result = await runSanityProvisioning(claim({ job: credentialJob }), {
      sanity,
      store: db.api,
      encrypt: encryption,
    });
    expect(result).toMatchObject({ status: 'manual_review', retryable: false });
    expect(sanity.createDeveloperToken).not.toHaveBeenCalled();
  });

  it('una creación de proyecto ambigua queda en revisión y no habilita reintento duplicador', async () => {
    const db = store();
    const result = await runSanityProvisioning(claim(), {
      sanity: provider({
        createProject: vi.fn(async () => {
          throw new SanityManagementError('connection', true, true);
        }),
      }),
      store: db.api,
      encrypt: encryption,
    });
    expect(result).toMatchObject({ status: 'manual_review', retryable: false });
    expect(db.failures).toEqual([{ code: 'connection', retryable: false, manualReview: true }]);
  });

  it('genera una clave interna estable y exige la identidad esperada en secreto backend', async () => {
    const input = {
      request_id: job.request_id,
      name: job.name,
      slug: job.slug,
      dataset: 'production' as const,
    };
    expect(await provisioningIdentity(input)).toEqual(await provisioningIdentity(input));
    expect((await provisioningIdentity(input)).projectId).toMatch(/^r[a-f0-9]{15}$/);
    expect(() =>
      sanityProvisioningConfiguration(
        (name) =>
          ({
            SANITY_PROVISIONER_TOKEN: 'private',
            SANITY_PROVISIONING_ORGANIZATION_ID: 'org-test',
          })[name],
      ),
    ).toThrow(/Identidad administradora/);
  });

  it('usa Projects API oficial, includeMembers y token Developer sin filtrar secretos', async () => {
    const requests: Request[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === 'POST' && request.url.endsWith('/projects'))
        return Response.json(
          { id: externalProjectId, displayName: job.name, organizationId: 'org-test' },
          { status: 201 },
        );
      if (request.method === 'POST' && request.url.endsWith('/tokens'))
        return Response.json({ id: 'token', label: 'label', key: 'private-key' }, { status: 201 });
      return Response.json({
        id: externalProjectId,
        displayName: job.name,
        organizationId: 'org-test',
        members: [{ id: expectedAdministratorId, roles: [{ name: 'administrator' }] }],
      });
    });
    const client = sanityManagement(
      { token: 'management-secret', organizationId: 'org-test', expectedAdministratorId },
      fetcher as typeof fetch,
    );
    await client.createProject(job.name);
    await client.getProject(externalProjectId, true);
    await client.createDeveloperToken(externalProjectId, 'label');
    const createBody = await requests[0].clone().json();
    expect(createBody).not.toHaveProperty('id');
    expect(JSON.stringify(createBody)).not.toContain('management-secret');
    expect(requests[1].url).toContain('includeMembers=true');
    expect(await requests[2].clone().json()).toMatchObject({ roleName: 'developer' });
  });

  it('sanitiza rechazos del proveedor sin propagar respuestas privadas', async () => {
    const client = sanityManagement(
      { token: 'management-secret', organizationId: 'org-test', expectedAdministratorId },
      vi.fn(
        async () => new Response('provider-private-diagnostic', { status: 403 }),
      ) as typeof fetch,
    );
    await expect(client.getProject(externalProjectId)).rejects.toMatchObject({
      code: 'permissions',
      message: 'Sanity management request failed',
    });
    await expect(client.getProject(externalProjectId)).rejects.not.toThrow(
      'provider-private-diagnostic',
    );
  });
});
