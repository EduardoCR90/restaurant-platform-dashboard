import { z } from 'zod';
import { HttpError } from '../../../shared/editor-service.ts';
import type { SanityProvisioningErrorCode } from '../../../shared/sanity-provisioning.ts';
import type { EnvironmentReader } from './environment.ts';

const project = z.object({
  id: z.string().regex(/^[a-z0-9]{5,16}$/),
  displayName: z.string(),
  organizationId: z.string().nullable(),
});
const accessMembership = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  roleNames: z.array(z.string().min(1)),
  resourceUserId: z.string().min(1).nullable().optional(),
});
const accessUser = z.object({
  sanityUserId: z.string().min(1),
  memberships: z.array(accessMembership),
});
const dataset = z.object({ name: z.string(), aclMode: z.string() });
const tokenMetadata = z.object({ id: z.string().min(1), label: z.string() });
const createdToken = tokenMetadata.extend({ key: z.string().min(1) });

export type SanityProject = z.infer<typeof project>;
export type SanityDataset = z.infer<typeof dataset>;

export class SanityManagementError extends Error {
  constructor(
    public readonly code: SanityProvisioningErrorCode,
    public readonly retryable: boolean,
    public readonly ambiguous = false,
    public readonly diagnostic?: 'incomplete_admin_response',
  ) {
    super('Sanity management request failed');
  }
}

export function sanityProvisioningConfiguration(env: EnvironmentReader) {
  const token = env('SANITY_PROVISIONER_TOKEN')?.trim();
  const organizationId = env('SANITY_PROVISIONING_ORGANIZATION_ID')?.trim();
  const expectedAdministratorId = env('SANITY_EXPECTED_ADMIN_USER_ID')?.trim();
  if (!token) throw new HttpError(503, 'Credencial de gestión de Sanity pendiente');
  if (!organizationId || !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId))
    throw new HttpError(503, 'Organización de Sanity pendiente de configuración');
  if (!expectedAdministratorId || !/^[A-Za-z0-9_-]{1,160}$/.test(expectedAdministratorId))
    throw new HttpError(503, 'Identidad administradora de Sanity pendiente de configuración');
  return Object.freeze({ token, organizationId, expectedAdministratorId });
}

function classified(status: number) {
  if (status === 401) return new SanityManagementError('credentials', true);
  if (status === 403) return new SanityManagementError('permissions', true);
  if (status === 402 || status === 422) return new SanityManagementError('billing_or_quota', true);
  if (status === 409) return new SanityManagementError('provider_conflict', false);
  if (status === 408 || status === 429 || status >= 500)
    return new SanityManagementError('connection', true);
  return new SanityManagementError('provider_response', false);
}

export type SanityManagement = ReturnType<typeof sanityManagement>;

export function sanityManagement(
  configuration: { token: string; organizationId: string; expectedAdministratorId: string },
  fetcher: typeof fetch = fetch,
) {
  const projectsBase = 'https://api.sanity.io/v2021-06-07';
  const accessBase = 'https://api.sanity.io/v2025-07-11';
  async function request(
    method: string,
    path: string,
    body?: unknown,
    allowNotFound = false,
    base = projectsBase,
  ) {
    let response: Response;
    try {
      response = await fetcher(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${configuration.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new SanityManagementError('connection', true, method === 'POST');
    }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw classified(response.status);
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new SanityManagementError('provider_response', false, method === 'POST');
    }
  }
  return Object.freeze({
    organizationId: configuration.organizationId,
    expectedAdministratorId: configuration.expectedAdministratorId,
    async getProject(id: string) {
      const value = await request('GET', `/projects/${id}`, undefined, true);
      return value === null ? null : project.parse(value);
    },
    async getProjectUser(projectId: string, sanityUserId: string) {
      const value = await request(
        'GET',
        `/access/project/${encodeURIComponent(projectId)}/users/${encodeURIComponent(sanityUserId)}?includeImpliedRoles=true`,
        undefined,
        true,
        accessBase,
      );
      if (value === null) return null;
      try {
        return accessUser.parse(value);
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new SanityManagementError(
            'provider_response',
            false,
            false,
            'incomplete_admin_response',
          );
        throw error;
      }
    },
    async createProject(displayName: string) {
      try {
        return project.parse(
          await request('POST', '/projects', {
            displayName,
            organizationId: configuration.organizationId,
            createDefaultCorsOrigin: false,
          }),
        );
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new SanityManagementError('provider_response', false, true);
        throw error;
      }
    },
    async listDatasets(projectId: string) {
      return z.array(dataset).parse(await request('GET', `/projects/${projectId}/datasets`));
    },
    async createDataset(projectId: string, name: string) {
      return z.object({ datasetName: z.string(), aclMode: z.string() }).parse(
        await request('PUT', `/projects/${projectId}/datasets/${name}`, {
          aclMode: 'public',
          description: 'Restaurant Platform editorial content',
        }),
      );
    },
    async listTokens(projectId: string) {
      return z.array(tokenMetadata).parse(await request('GET', `/projects/${projectId}/tokens`));
    },
    async createDeveloperToken(projectId: string, label: string) {
      try {
        return createdToken.parse(
          await request('POST', `/projects/${projectId}/tokens`, { label, roleName: 'developer' }),
        );
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new SanityManagementError('credential_ambiguous', false, true);
        if (error instanceof SanityManagementError && error.ambiguous)
          throw new SanityManagementError('credential_ambiguous', false, true);
        throw error;
      }
    },
  });
}
