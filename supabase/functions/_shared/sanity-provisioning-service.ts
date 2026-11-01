import { z } from 'zod';
import {
  sanityProvisioningJob,
  type SanityProvisioningErrorCode,
  type SanityProvisioningJob,
  type SanityProvisioningStage,
} from '../../../shared/sanity-provisioning.ts';
import type { EncryptedCredential } from './integration-credentials.ts';
import {
  SanityManagementError,
  type SanityManagement,
  type SanityProject,
} from './sanity-management.ts';

export type ProvisioningClaim = Readonly<{
  execute: boolean;
  leaseToken: string | null;
  job: SanityProvisioningJob;
}>;

export type ProvisioningStore = {
  checkpoint(stage: SanityProvisioningStage): Promise<void>;
  complete(input: {
    providerTokenId: string;
    credential: EncryptedCredential;
  }): Promise<SanityProvisioningJob>;
  fail(input: {
    code: SanityProvisioningErrorCode;
    retryable: boolean;
    manualReview: boolean;
  }): Promise<SanityProvisioningJob>;
};

function assertProject(
  value: SanityProject,
  expected: { id: string; name: string; organizationId: string },
) {
  if (
    value.id !== expected.id ||
    value.displayName !== expected.name ||
    value.organizationId !== expected.organizationId
  )
    throw new SanityManagementError('provider_conflict', false);
}

async function ensureProject(job: SanityProvisioningJob, sanity: SanityManagement) {
  const expected = {
    id: job.project_id,
    name: job.name,
    organizationId: sanity.organizationId,
  };
  let current = await sanity.getProject(job.project_id);
  if (!current) {
    try {
      current = await sanity.createProject(job.project_id, job.name);
    } catch (error) {
      if (!(error instanceof SanityManagementError) || error.code !== 'provider_conflict')
        throw error;
      current = await sanity.getProject(job.project_id);
      if (!current) throw error;
    }
  }
  assertProject(current, expected);
}

async function ensureDataset(job: SanityProvisioningJob, sanity: SanityManagement) {
  let datasets = await sanity.listDatasets(job.project_id);
  let current = datasets.find((item) => item.name === job.dataset);
  if (!current) {
    try {
      const created = await sanity.createDataset(job.project_id, job.dataset);
      current = { name: created.datasetName, aclMode: created.aclMode };
    } catch (error) {
      if (!(error instanceof SanityManagementError) || error.code !== 'provider_conflict')
        throw error;
      datasets = await sanity.listDatasets(job.project_id);
      current = datasets.find((item) => item.name === job.dataset);
      if (!current) throw error;
    }
  }
  if (current.name !== job.dataset || current.aclMode !== 'public')
    throw new SanityManagementError('provider_conflict', false);
}

export async function runSanityProvisioning(
  claim: ProvisioningClaim,
  dependencies: {
    sanity: SanityManagement;
    store: ProvisioningStore;
    encrypt(token: string, integrationId: string): Promise<EncryptedCredential>;
  },
): Promise<SanityProvisioningJob> {
  if (!claim.execute) return claim.job;
  if (!claim.leaseToken) throw new Error('Missing provisioning lease');
  const job = sanityProvisioningJob.parse(claim.job);
  let stage = job.stage;
  let tokenCreated = false;
  try {
    if (stage === 'queued') {
      await ensureProject(job, dependencies.sanity);
      await dependencies.store.checkpoint('project_ready');
      stage = 'project_ready';
    }
    if (stage === 'project_ready') {
      await ensureDataset(job, dependencies.sanity);
      await dependencies.store.checkpoint('dataset_ready');
      stage = 'dataset_ready';
    }
    if (stage === 'dataset_ready') {
      await dependencies.store.checkpoint('credential_pending');
      stage = 'credential_pending';
    }
    if (stage !== 'credential_pending') throw new Error('Invalid provisioning stage');
    const label = `restaurant-platform-${job.integration_id}`;
    const existing = await dependencies.sanity.listTokens(job.project_id);
    if (existing.some((token) => token.label === label))
      throw new SanityManagementError('credential_ambiguous', false, true);
    const token = await dependencies.sanity.createEditorToken(job.project_id, label);
    tokenCreated = true;
    let credential: EncryptedCredential;
    try {
      credential = await dependencies.encrypt(token.key, job.integration_id);
    } catch {
      throw new SanityManagementError('credential_storage', false, true);
    }
    try {
      return await dependencies.store.complete({
        providerTokenId: token.id,
        credential,
      });
    } catch {
      throw new SanityManagementError('credential_storage', false, true);
    }
  } catch (error) {
    const known =
      error instanceof SanityManagementError
        ? error
        : new SanityManagementError(
            tokenCreated || stage === 'credential_pending'
              ? 'credential_ambiguous'
              : 'provider_response',
            stage !== 'credential_pending',
            tokenCreated || stage === 'credential_pending',
          );
    return dependencies.store.fail({
      code: known.code,
      retryable: known.retryable && !known.ambiguous,
      manualReview: known.ambiguous,
    });
  }
}

export function provisioningClaim(input: unknown): ProvisioningClaim {
  const value = z
    .object({
      execute: z.boolean(),
      lease_token: z.uuid().nullable(),
      job: sanityProvisioningJob,
    })
    .strict()
    .parse(input);
  return { execute: value.execute, leaseToken: value.lease_token, job: value.job };
}
