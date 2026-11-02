import { z } from 'zod';
import {
  astroProvisioningJob,
  type AstroProvisioningErrorCode,
  type AstroProvisioningJob,
  type AstroProvisioningStage,
} from '../../../shared/astro-provisioning.ts';
import type { GithubManagement, GithubRepository } from './github-management.ts';
import { GithubManagementError } from './github-management.ts';
import { encodedSpecification, instanceSpec, sha256 } from './astro-provisioning-request.ts';

export type AstroProvisioningClaim = Readonly<{
  execute: boolean;
  leaseToken: string | null;
  job: AstroProvisioningJob;
}>;

export type AstroProvisioningStore = {
  checkpoint(
    stage: AstroProvisioningStage,
    evidence?: { repositoryId?: string; specificationHash?: string },
  ): Promise<AstroProvisioningJob>;
  awaitCallback(): Promise<AstroProvisioningJob>;
  complete(input: { pagesUrl: string }): Promise<AstroProvisioningJob>;
  fail(input: {
    code: AstroProvisioningErrorCode;
    retryable: boolean;
    manualReview: boolean;
  }): Promise<AstroProvisioningJob>;
};

export class AstroProvisioningDatabaseError extends Error {
  constructor() {
    super('Astro provisioning state unavailable');
  }
}

function validateTemplate(repository: GithubRepository, github: GithubManagement) {
  if (
    repository.id !== github.templateRepositoryId ||
    repository.fullName.toLowerCase() !== github.templateRepository.toLowerCase() ||
    repository.defaultBranch !== 'main' ||
    !repository.isTemplate
  )
    throw new GithubManagementError('template_mismatch', false);
}

function validateTarget(
  repository: GithubRepository,
  job: AstroProvisioningJob,
  github: GithubManagement,
) {
  if (
    repository.fullName.toLowerCase() !== job.repository.toLowerCase() ||
    repository.owner.toLowerCase() !== github.owner.toLowerCase() ||
    repository.defaultBranch !== 'main' ||
    repository.private !== (github.visibility === 'private') ||
    repository.templateRepositoryId !== github.templateRepositoryId
  )
    throw new GithubManagementError('repository_conflict', false, true);
}

async function ensureRepository(job: AstroProvisioningJob, github: GithubManagement) {
  const template = await github.getRepository(github.templateRepository);
  if (!template) throw new GithubManagementError('template_mismatch', false);
  validateTemplate(template, github);
  if (
    (await github.getHead(template.fullName, template.defaultBranch)) !== job.template.source_commit
  )
    throw new GithubManagementError('template_mismatch', false);

  let repository = await github.getRepository(job.repository);
  if (!repository) {
    try {
      repository = await github.generateRepository(
        job.repository.split('/')[1],
        `Web Astro de ${job.name}, gestionada por Restaurant Platform`,
      );
    } catch (error) {
      if (!(error instanceof GithubManagementError) || !error.ambiguous) throw error;
      repository = await github.getRepository(job.repository);
      if (!repository) throw error;
    }
  }
  validateTarget(repository, job, github);
  return repository;
}

export async function runAstroProvisioning(
  claim: AstroProvisioningClaim,
  dependencies: {
    github: GithubManagement;
    store: AstroProvisioningStore;
    endpoints: { publication: string; provisioning: string };
  },
): Promise<AstroProvisioningJob> {
  if (!claim.execute) return claim.job;
  if (!claim.leaseToken) throw new Error('Missing provisioning lease');
  let job = astroProvisioningJob.parse(claim.job);
  try {
    const specification = await encodedSpecification(instanceSpec(job, dependencies.endpoints));
    if (job.specification_hash && job.specification_hash !== specification.hash)
      throw new GithubManagementError('template_mismatch', false, true);
    if (job.stage === 'queued') {
      const repository = await ensureRepository(job, dependencies.github);
      job = await dependencies.store.checkpoint('repository_created', {
        repositoryId: repository.id,
        specificationHash: specification.hash,
      });
    }
    if (job.stage === 'repository_created' || job.stage === 'initialization_dispatched') {
      await dependencies.github.dispatch(job.repository, {
        request_id: job.request_id,
        specification_b64: specification.base64url,
        specification_hash: specification.hash,
      });
      return dependencies.store.awaitCallback();
    }
    if (job.stage === 'source_ready') {
      const pages = await dependencies.github.enablePages(job.repository);
      if (new URL(pages.url).href !== new URL(job.site_url).href)
        throw new GithubManagementError('pages', false, true);
      return dependencies.store.complete({ pagesUrl: pages.url });
    }
    throw new GithubManagementError('provider_response', false);
  } catch (error) {
    const known =
      error instanceof GithubManagementError
        ? error
        : error instanceof AstroProvisioningDatabaseError
          ? new GithubManagementError('database', true)
          : new GithubManagementError(
              'provider_response',
              false,
              job.stage === 'repository_created',
            );
    return dependencies.store.fail({
      code: known.code,
      retryable: known.retryable && !known.ambiguous,
      manualReview: known.ambiguous,
    });
  }
}

const manifestSchema = z
  .object({
    format: z.literal(1),
    request_id: z.uuid(),
    specification_hash: z.string().regex(/^[a-f0-9]{64}$/),
    configuration_hash: z.string().regex(/^[a-f0-9]{64}$/),
    repository: z.string(),
    template: z.object({
      template_key: z.string(),
      version: z.string(),
      source_commit: z.string(),
      distribution_hash: z.string(),
      configuration_contract: z.number(),
      content_contract: z.string(),
      visual_contract: z.number(),
    }),
    sanity: z.object({ project_id: z.string(), dataset: z.string() }),
    deployment: z.object({ publication_endpoint: z.string(), provisioning_endpoint: z.string() }),
  })
  .strict();

export async function verifyProvisionedSource(
  jobInput: AstroProvisioningJob,
  input: { sourceCommit: string; manifestHash: string },
  github: GithubManagement,
) {
  const job = astroProvisioningJob.parse(jobInput);
  if (job.stage !== 'initialization_dispatched' && job.stage !== 'source_ready')
    throw new GithubManagementError('manifest', false);
  const bytes = await github.readFile(job.repository, 'instance.manifest.json', input.sourceCommit);
  if ((await sha256(bytes)) !== input.manifestHash)
    throw new GithubManagementError('manifest', false, true);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new GithubManagementError('manifest', false, true);
  }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new GithubManagementError('manifest', false, true);
  const manifest = parsed.data;
  if (
    manifest.request_id !== job.request_id ||
    manifest.specification_hash !== job.specification_hash ||
    manifest.repository.toLowerCase() !== job.repository.toLowerCase() ||
    manifest.template.template_key !== job.template.template_key ||
    manifest.template.version !== job.template.version ||
    manifest.template.source_commit !== job.template.source_commit ||
    manifest.template.distribution_hash !== job.template.distribution_hash ||
    manifest.sanity.project_id !== job.project_id ||
    manifest.sanity.dataset !== job.dataset
  )
    throw new GithubManagementError('manifest', false, true);
  return { sourceCommit: input.sourceCommit, manifestHash: input.manifestHash };
}

export function astroProvisioningClaim(input: unknown): AstroProvisioningClaim {
  const value = z
    .object({
      execute: z.boolean(),
      lease_token: z.uuid().nullable(),
      job: astroProvisioningJob,
    })
    .strict()
    .parse(input);
  return { execute: value.execute, leaseToken: value.lease_token, job: value.job };
}
