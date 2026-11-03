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
    getProject: vi.fn(async () => ({
      id: externalProjectId,
      displayName: job.name,
      organizationId: 'org-test',
    })),
    getProjectUser: vi.fn(async () => ({
      sanityUserId: expectedAdministratorId,
      memberships: [
        {
          resourceType: 'project',
          resourceId: externalProjectId,
          roleNames: ['administrator'],
          resourceUserId: 'project-specific-user-id',
        },
      ],
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
    ['usuario esperado inexistente', null],
    ['robot con rol administrador', null],
  ])('mantiene la espera cuando Access Users no devuelve al humano: %s', async () => {
    const db = store(waitingJob);
    const sanity = provider({
      getProjectUser: vi.fn(async () => null),
    });
    const observeAdminVerification = vi.fn();
    const result = await runSanityProvisioning(claim({ job: waitingJob }), {
      sanity,
      store: db.api,
      encrypt: encryption,
      observeAdminVerification,
    });
    expect(result).toMatchObject({ status: 'awaiting', stage: 'awaiting_sanity_admin' });
    expect(db.api.waitForAdmin).toHaveBeenCalledOnce();
    expect(observeAdminVerification).toHaveBeenCalledWith('expected_user_not_found');
    expect(sanity.createDataset).not.toHaveBeenCalled();
  });

  it.each([['developer'], ['Administrator']])(
    'mantiene la espera si el rol efectivo no usa el nombre canónico oficial: %s',
    async (roleName) => {
      const db = store(waitingJob);
      const sanity = provider({
        getProjectUser: vi.fn(async () => ({
          sanityUserId: expectedAdministratorId,
          memberships: [
            {
              resourceType: 'project',
              resourceId: externalProjectId,
              roleNames: [roleName],
              resourceUserId: 'different-from-sanity-user-id',
            },
          ],
        })),
      });
      const observeAdminVerification = vi.fn();
      const result = await runSanityProvisioning(claim({ job: waitingJob }), {
        sanity,
        store: db.api,
        encrypt: encryption,
        observeAdminVerification,
      });
      expect(result).toMatchObject({ status: 'awaiting', stage: 'awaiting_sanity_admin' });
      expect(observeAdminVerification).toHaveBeenCalledWith('administrator_role_missing');
      expect(sanity.createDataset).not.toHaveBeenCalled();
    },
  );

  it('detiene una respuesta incompleta o una identidad incoherente sin dejarla avanzar', async () => {
    const db = store(waitingJob);
    const observeAdminVerification = vi.fn();
    const result = await runSanityProvisioning(claim({ job: waitingJob }), {
      sanity: provider({
        getProjectUser: vi.fn(async () => ({
          sanityUserId: 'different-human-user',
          memberships: [],
        })),
      }),
      store: db.api,
      encrypt: encryption,
      observeAdminVerification,
    });
    expect(result).toMatchObject({ status: 'failed', error_code: 'provider_response' });
    expect(observeAdminVerification).toHaveBeenCalledWith('incomplete_response');
    expect(db.api.waitForAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ['credentials' as const, 'authentication_error'],
    ['permissions' as const, 'permission_error'],
  ])('distingue fallos seguros de Access API: %s', async (code, outcome) => {
    const db = store(waitingJob);
    const observeAdminVerification = vi.fn();
    const result = await runSanityProvisioning(claim({ job: waitingJob }), {
      sanity: provider({
        getProjectUser: vi.fn(async () => {
          throw new SanityManagementError(code, true);
        }),
      }),
      store: db.api,
      encrypt: encryption,
      observeAdminVerification,
    });
    expect(result).toMatchObject({ status: 'failed', error_code: code });
    expect(observeAdminVerification).toHaveBeenCalledWith(outcome);
  });

  it('verifica identidad y rol, reutiliza dataset y continúa con un token Developer', async () => {
    const db = store(waitingJob);
    const sanity = provider({
      listDatasets: vi.fn(async () => [{ name: 'production', aclMode: 'public' }]),
    });
    const encrypt = vi.fn(encryption);
    const observeAdminVerification = vi.fn();
    const result = await runSanityProvisioning(claim({ job: waitingJob }), {
      sanity,
      store: db.api,
      encrypt,
      observeAdminVerification,
    });
    expect(result).toBe(db.completed);
    expect(db.checkpoints).toEqual(['admin_verified', 'dataset_ready', 'credential_pending']);
    expect(sanity.getProject).toHaveBeenCalledWith(externalProjectId);
    expect(sanity.getProjectUser).toHaveBeenCalledWith(externalProjectId, expectedAdministratorId);
    expect(observeAdminVerification).toHaveBeenCalledWith('verified');
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

  it('usa Projects y Access API oficiales con sanityUserId y token Developer', async () => {
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
      if (request.url.includes('/v2025-07-11/access/project/'))
        return Response.json({
          sanityUserId: expectedAdministratorId,
          memberships: [
            {
              resourceType: 'project',
              resourceId: externalProjectId,
              roleNames: ['administrator'],
              resourceUserId: 'project-specific-user-id',
            },
          ],
        });
      return Response.json({
        id: externalProjectId,
        displayName: job.name,
        organizationId: 'org-test',
      });
    });
    const client = sanityManagement(
      { token: 'management-secret', organizationId: 'org-test', expectedAdministratorId },
      fetcher as typeof fetch,
    );
    await client.createProject(job.name);
    await client.getProject(externalProjectId);
    await client.getProjectUser(externalProjectId, expectedAdministratorId);
    await client.createDeveloperToken(externalProjectId, 'label');
    const createBody = await requests[0].clone().json();
    expect(createBody).not.toHaveProperty('id');
    expect(JSON.stringify(createBody)).not.toContain('management-secret');
    expect(requests[1].url).toBe(`https://api.sanity.io/v2021-06-07/projects/${externalProjectId}`);
    expect(requests[2].url).toBe(
      `https://api.sanity.io/v2025-07-11/access/project/${externalProjectId}/users/${expectedAdministratorId}?includeImpliedRoles=true`,
    );
    expect(await requests[3].clone().json()).toMatchObject({ roleName: 'developer' });
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

  it('clasifica como incompleta una respuesta Access sin memberships', async () => {
    const client = sanityManagement(
      { token: 'management-secret', organizationId: 'org-test', expectedAdministratorId },
      vi.fn(async () =>
        Response.json({ sanityUserId: expectedAdministratorId, profile: { id: 'private' } }),
      ) as typeof fetch,
    );
    await expect(
      client.getProjectUser(externalProjectId, expectedAdministratorId),
    ).rejects.toMatchObject({
      code: 'provider_response',
      diagnostic: 'incomplete_admin_response',
    });
  });
});
