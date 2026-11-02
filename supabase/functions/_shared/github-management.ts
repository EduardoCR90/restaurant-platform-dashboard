import { z } from 'zod';
import type { AstroProvisioningErrorCode } from '../../../shared/astro-provisioning.ts';
import { HttpError } from '../../../shared/editor-service.ts';
import type { EnvironmentReader } from './environment.ts';

const repositoryName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const numeric = z.union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]+$/)]);
const repositorySchema = z
  .object({
    id: numeric,
    full_name: repositoryName,
    private: z.boolean(),
    default_branch: z.string().min(1),
    owner: z.object({ login: z.string().min(1) }).passthrough(),
    is_template: z.boolean().optional(),
    template_repository: z
      .object({ id: numeric, full_name: repositoryName })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }).passthrough();
const contentSchema = z
  .object({
    type: z.literal('file'),
    encoding: z.literal('base64'),
    content: z.string(),
    size: z.number().int().nonnegative().max(100000),
  })
  .passthrough();
const pagesSchema = z
  .object({ html_url: z.url(), build_type: z.literal('workflow') })
  .passthrough();

export type GithubRepository = {
  id: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  owner: string;
  isTemplate: boolean;
  templateRepositoryId: string | null;
};

export type GithubManagement = {
  owner: string;
  visibility: 'private' | 'public';
  templateRepository: string;
  templateRepositoryId: string;
  workflow: string;
  getRepository(repository: string): Promise<GithubRepository | null>;
  getHead(repository: string, branch: string): Promise<string>;
  generateRepository(name: string, description: string): Promise<GithubRepository>;
  dispatch(repository: string, inputs: Record<string, string>): Promise<void>;
  readFile(repository: string, path: string, ref: string): Promise<Uint8Array>;
  enablePages(repository: string): Promise<{ url: string }>;
};

export class GithubManagementError extends Error {
  constructor(
    readonly code: AstroProvisioningErrorCode,
    readonly retryable: boolean,
    readonly ambiguous = false,
  ) {
    super(code);
  }
}

function required(env: EnvironmentReader, name: string) {
  const value = env(name)?.trim();
  if (!value) throw new HttpError(503, `Configuración backend pendiente: ${name}`);
  return value;
}

export function githubProvisioningConfiguration(env: EnvironmentReader) {
  const token = required(env, 'GITHUB_PROVISIONER_TOKEN');
  if (token.length < 20) throw new HttpError(503, 'Credencial GitHub de backend inválida');
  const owner = z
    .string()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/)
    .parse(required(env, 'GITHUB_REPOSITORY_OWNER'));
  const templateRepository = repositoryName.parse(required(env, 'GITHUB_TEMPLATE_REPOSITORY'));
  const templateRepositoryId = z
    .string()
    .regex(/^[1-9][0-9]+$/)
    .parse(required(env, 'GITHUB_TEMPLATE_REPOSITORY_ID'));
  const workflow = z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\.yml$/)
    .parse(env('GITHUB_INSTANCE_BOOTSTRAP_WORKFLOW')?.trim() || 'bootstrap-instance.yml');
  const visibility = z
    .enum(['private', 'public'])
    .parse(env('GITHUB_INSTANCE_VISIBILITY')?.trim() || 'private');
  return { token, owner, templateRepository, templateRepositoryId, workflow, visibility };
}

function mappedStatus(status: number, operation: 'read' | 'write') {
  if (status === 401) return new GithubManagementError('credentials', false);
  if (status === 403) return new GithubManagementError('permissions', false);
  if (status === 422 || status === 429)
    return new GithubManagementError(
      status === 422 ? 'repository_conflict' : 'billing_or_quota',
      false,
    );
  if (status >= 500) return new GithubManagementError('connection', true, operation === 'write');
  return new GithubManagementError(
    operation === 'write' ? 'provider_response' : 'connection',
    false,
  );
}

function asRepository(input: unknown): GithubRepository {
  const value = repositorySchema.parse(input);
  return {
    id: String(value.id),
    fullName: value.full_name,
    private: value.private,
    defaultBranch: value.default_branch,
    owner: value.owner.login,
    isTemplate: value.is_template === true,
    templateRepositoryId: value.template_repository ? String(value.template_repository.id) : null,
  };
}

export function githubManagement(
  configuration: ReturnType<typeof githubProvisioningConfiguration>,
  fetcher: typeof fetch = fetch,
): GithubManagement {
  const call = async (
    path: string,
    options: RequestInit = {},
    allowed: number[] = [200],
    operation: 'read' | 'write' = 'read',
  ) => {
    let response: Response;
    try {
      response = await fetcher(`https://api.github.com${path}`, {
        ...options,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${configuration.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
    } catch {
      throw new GithubManagementError('connection', true, operation === 'write');
    }
    if (!allowed.includes(response.status)) throw mappedStatus(response.status, operation);
    if (response.status === 404) return null;
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new GithubManagementError('provider_response', false, operation === 'write');
    }
  };
  const repoPath = (repository: string) => `/repos/${repositoryName.parse(repository)}`;
  const getRepository = async (repository: string) => {
    const result = await call(repoPath(repository), {}, [200, 404]);
    return result ? asRepository(result) : null;
  };
  const pages = async (repository: string) => {
    const result = await call(`${repoPath(repository)}/pages`, {}, [200, 404]);
    if (!result) return null;
    const parsed = pagesSchema.safeParse(result);
    if (!parsed.success) throw new GithubManagementError('pages', false, true);
    return parsed.data;
  };
  return {
    owner: configuration.owner,
    visibility: configuration.visibility,
    templateRepository: configuration.templateRepository,
    templateRepositoryId: configuration.templateRepositoryId,
    workflow: configuration.workflow,
    getRepository,
    async getHead(repository, branch) {
      const result = await call(`${repoPath(repository)}/commits/${encodeURIComponent(branch)}`);
      return commitSchema.parse(result).sha;
    },
    async generateRepository(name, description) {
      const result = await call(
        `${repoPath(configuration.templateRepository)}/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner: configuration.owner,
            name,
            description,
            private: configuration.visibility === 'private',
            include_all_branches: false,
          }),
        },
        [201],
        'write',
      );
      return asRepository(result);
    },
    async dispatch(repository, inputs) {
      try {
        await call(
          `${repoPath(repository)}/actions/workflows/${encodeURIComponent(configuration.workflow)}/dispatches`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: 'main', inputs }),
          },
          [204],
          'write',
        );
      } catch (error) {
        if (
          error instanceof GithubManagementError &&
          ['credentials', 'permissions'].includes(error.code)
        )
          throw error;
        throw new GithubManagementError('dispatch', true);
      }
    },
    async readFile(repository, path, ref) {
      const result = contentSchema.parse(
        await call(
          `${repoPath(repository)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
        ),
      );
      const binary = atob(result.content.replaceAll('\n', ''));
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    },
    async enablePages(repository) {
      let current = await pages(repository);
      if (!current) {
        try {
          await call(
            `${repoPath(repository)}/pages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ build_type: 'workflow' }),
            },
            [201],
            'write',
          );
        } catch (error) {
          if (
            !(error instanceof GithubManagementError) ||
            (!error.ambiguous && error.code !== 'repository_conflict')
          )
            throw error;
        }
        current = await pages(repository);
      }
      if (!current) throw new GithubManagementError('pages', true);
      return { url: current.html_url };
    },
  };
}
