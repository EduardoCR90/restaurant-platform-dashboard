import { z } from 'zod';
import { provisioningSpec } from './platform-contract.ts';

const portableRestaurant = provisioningSpec.shape.restaurant.shape;

export const sanityProvisioningRequest = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('start'),
      payload: z
        .object({
          request_id: z.uuid(),
          name: portableRestaurant.name,
          slug: portableRestaurant.slug,
          dataset: z.literal('production').default('production'),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.enum(['retry', 'status']),
      payload: z.object({ request_id: z.uuid() }).strict(),
    })
    .strict(),
]);

export const sanityProvisioningStatus = z.enum(['running', 'succeeded', 'failed', 'manual_review']);

export const sanityProvisioningStage = z.enum([
  'queued',
  'project_ready',
  'dataset_ready',
  'credential_pending',
  'completed',
]);

export const sanityProvisioningErrorCode = z.enum([
  'credentials',
  'permissions',
  'billing_or_quota',
  'connection',
  'provider_conflict',
  'provider_response',
  'credential_ambiguous',
  'credential_storage',
  'database',
]);

export const sanityProvisioningJob = z
  .object({
    request_id: z.uuid(),
    restaurant_id: provisioningSpec.shape.restaurant.shape.id,
    integration_id: provisioningSpec.shape.sanity.shape.integration_id,
    name: portableRestaurant.name,
    slug: portableRestaurant.slug,
    project_id: z.string().regex(/^[a-z0-9]{5,16}$/),
    dataset: z.literal('production'),
    status: sanityProvisioningStatus,
    stage: sanityProvisioningStage,
    attempt_count: z.number().int().positive(),
    retryable: z.boolean(),
    error_code: sanityProvisioningErrorCode.nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export type SanityProvisioningRequest = z.infer<typeof sanityProvisioningRequest>;
export type SanityProvisioningJob = z.infer<typeof sanityProvisioningJob>;
export type SanityProvisioningStage = z.infer<typeof sanityProvisioningStage>;
export type SanityProvisioningErrorCode = z.infer<typeof sanityProvisioningErrorCode>;
