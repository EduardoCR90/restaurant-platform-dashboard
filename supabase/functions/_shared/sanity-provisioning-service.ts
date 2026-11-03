import { z } from 'zod';
import {
  sanityProvisioningJob,
  type SanityAdminVerificationOutcome,
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
  pauseForAdmin(projectId: string): Promise<SanityProvisioningJob>;
  waitForAdmin(): Promise<SanityProvisioningJob>;
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

export type SanityProvisioningObservation = Readonly<{
  stage: SanityProvisioningStage;
  errorCode: SanityProvisioningErrorCode;
  retryable: boolean;
  manualReview: boolean;
}>;

function observe(
  listener: ((event: SanityProvisioningObservation) => void) | undefined,
  event: SanityProvisioningObservation,
) {
  try {
    listener?.(event);
  } catch {
    // La observabilidad nunca puede cambiar el estado del aprovisionamiento.
  }
}

function observeAdmin(
  listener: ((outcome: SanityAdminVerificationOutcome) => void) | undefined,
  outcome: SanityAdminVerificationOutcome,
) {
  try {
    listener?.(outcome);
  } catch {
    // La observabilidad nunca puede autorizar ni bloquear el aprovisionamiento.
  }
}

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
  if (!job.project_id) {
    const created = await sanity.createProject(job.name);
    assertProject(created, {
      id: created.id,
      name: job.name,
      organizationId: sanity.organizationId,
    });
    return created.id;
  }
  const expected = {
    id: job.project_id,
    name: job.name,
    organizationId: sanity.organizationId,
  };
  const current = await sanity.getProject(job.project_id);
  if (!current) throw new SanityManagementError('provider_conflict', false);
  assertProject(current, expected);
  return current.id;
}

async function expectedAdministratorIsReady(
  job: SanityProvisioningJob,
  sanity: SanityManagement,
  listener?: (outcome: SanityAdminVerificationOutcome) => void,
) {
  if (!job.project_id) throw new SanityManagementError('provider_response', false);
  try {
    const current = await sanity.getProject(job.project_id);
    if (!current) throw new SanityManagementError('provider_conflict', false);
    assertProject(current, {
      id: job.project_id,
      name: job.name,
      organizationId: sanity.organizationId,
    });
    const expected = await sanity.getProjectUser(job.project_id, sanity.expectedAdministratorId);
    if (!expected) {
      observeAdmin(listener, 'expected_user_not_found');
      return false;
    }
    const membership = expected.memberships.find(
      (item) => item.resourceType === 'project' && item.resourceId === job.project_id,
    );
    if (expected.sanityUserId !== sanity.expectedAdministratorId || !membership)
      throw new SanityManagementError(
        'provider_response',
        false,
        false,
        'incomplete_admin_response',
      );
    if (!membership.roleNames.includes('administrator')) {
      observeAdmin(listener, 'administrator_role_missing');
      return false;
    }
    observeAdmin(listener, 'verified');
    return true;
  } catch (error) {
    if (error instanceof SanityManagementError) {
      if (error.code === 'credentials') observeAdmin(listener, 'authentication_error');
      else if (error.code === 'permissions') observeAdmin(listener, 'permission_error');
      else if (error.diagnostic === 'incomplete_admin_response')
        observeAdmin(listener, 'incomplete_response');
    }
    throw error;
  }
}

async function ensureDataset(job: SanityProvisioningJob, sanity: SanityManagement) {
  if (!job.project_id) throw new SanityManagementError('provider_response', false);
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
    observe?: (event: SanityProvisioningObservation) => void;
    observeAdminVerification?: (outcome: SanityAdminVerificationOutcome) => void;
  },
): Promise<SanityProvisioningJob> {
  if (!claim.execute) return claim.job;
  if (!claim.leaseToken) throw new Error('Missing provisioning lease');
  const job = sanityProvisioningJob.parse(claim.job);
  let stage = job.stage;
  let tokenCreated = false;
  let projectCreated = false;
  try {
    if (stage === 'queued') {
      const projectId = await ensureProject(job, dependencies.sanity);
      projectCreated = job.project_id === null;
      return dependencies.store.pauseForAdmin(projectId);
    }
    if (stage === 'awaiting_sanity_admin') {
      if (
        !(await expectedAdministratorIsReady(
          job,
          dependencies.sanity,
          dependencies.observeAdminVerification,
        ))
      )
        return dependencies.store.waitForAdmin();
      await dependencies.store.checkpoint('admin_verified');
      stage = 'admin_verified';
    }
    if (stage === 'admin_verified' || stage === 'project_ready') {
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
    if (!job.project_id) throw new SanityManagementError('provider_response', false);
    const existing = await dependencies.sanity.listTokens(job.project_id);
    if (existing.some((token) => token.label === label))
      throw new SanityManagementError('credential_ambiguous', false, true);
    const token = await dependencies.sanity.createDeveloperToken(job.project_id, label);
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
            stage !== 'credential_pending' && !projectCreated,
            tokenCreated || stage === 'credential_pending' || projectCreated,
          );
    observe(dependencies.observe, {
      stage,
      errorCode: known.code,
      retryable: known.retryable && !known.ambiguous,
      manualReview: known.ambiguous,
    });
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
