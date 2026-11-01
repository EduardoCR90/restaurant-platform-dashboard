import { z } from 'zod';
import { HttpError } from '../../../shared/editor-service.ts';
import type { SanityProvisioningErrorCode } from '../../../shared/sanity-provisioning.ts';
import type { EnvironmentReader } from './environment.ts';

const project = z.object({
  id: z.string().regex(/^[a-z0-9]{5,16}$/),
  displayName: z.string(),
  organizationId: z.string().nullable(),
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
  ) {
    super('Sanity management request failed');
  }
}

export function sanityProvisioningConfiguration(env: EnvironmentReader) {
  const token = env('SANITY_PROVISIONER_TOKEN')?.trim();
  const organizationId = env('SANITY_PROVISIONING_ORGANIZATION_ID')?.trim();
  if (!token) throw new HttpError(503, 'Credencial de gestión de Sanity pendiente');
  if (!organizationId || !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId))
    throw new HttpError(503, 'Organización de Sanity pendiente de configuración');
  return Object.freeze({ token, organizationId });
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
  configuration: { token: string; organizationId: string },
  fetcher: typeof fetch = fetch,
) {
  const base = 'https://api.sanity.io/v2021-06-07';
  async function request(method: string, path: string, body?: unknown, allowNotFound = false) {
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
    async getProject(id: string) {
      const value = await request('GET', `/projects/${id}`, undefined, true);
      return value === null ? null : project.parse(value);
    },
    async createProject(id: string, displayName: string) {
      try {
        return project.parse(
          await request('POST', '/projects', {
            id,
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
    async createEditorToken(projectId: string, label: string) {
      try {
        return createdToken.parse(
          await request('POST', `/projects/${projectId}/tokens`, { label, roleName: 'editor' }),
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
