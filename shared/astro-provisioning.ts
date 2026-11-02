import { z } from 'zod';
import {
  hostnameSchema,
  moduleConfigurationSchema,
  moduleNames,
  provisioningSpec,
  templateReleaseSchema,
} from './platform-contract.ts';
import { storedThemeSchema } from './visual.ts';

const templateSelection = templateReleaseSchema
  .pick({ template_key: true, version: true })
  .strict();
const modules = z
  .array(moduleConfigurationSchema)
  .max(moduleNames.length)
  .refine(
    (items) => new Set(items.map((item) => item.key)).size === items.length,
    'Unique modules',
  );

export const astroProvisioningRequest = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('start'),
      payload: z
        .object({
          request_id: z.uuid(),
          sanity_request_id: z.uuid(),
          template: templateSelection,
          visual: storedThemeSchema.default({}),
          modules: modules.default([]),
          custom_domain: hostnameSchema.optional(),
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

export const astroProvisioningStatus = z.enum(['running', 'succeeded', 'failed', 'manual_review']);
export const astroProvisioningStage = z.enum([
  'queued',
  'repository_created',
  'initialization_dispatched',
  'source_ready',
  'completed',
]);
export const astroProvisioningErrorCode = z.enum([
  'credentials',
  'permissions',
  'billing_or_quota',
  'connection',
  'repository_conflict',
  'template_mismatch',
  'provider_response',
  'dispatch',
  'manifest',
  'pages',
  'database',
]);

export const astroProvisioningJob = z
  .object({
    request_id: z.uuid(),
    sanity_request_id: z.uuid(),
    restaurant_id: provisioningSpec.shape.restaurant.shape.id,
    integration_id: provisioningSpec.shape.sanity.shape.integration_id,
    name: provisioningSpec.shape.restaurant.shape.name,
    slug: provisioningSpec.shape.restaurant.shape.slug,
    project_id: provisioningSpec.shape.sanity.shape.project_id,
    dataset: provisioningSpec.shape.sanity.shape.dataset,
    template: templateReleaseSchema,
    visual: storedThemeSchema,
    modules,
    custom_domain: hostnameSchema.nullable(),
    repository: provisioningSpec.shape.site.shape.repository,
    repository_id: z
      .string()
      .regex(/^[1-9][0-9]+$/)
      .nullable(),
    site_url: z.url(),
    base_path: provisioningSpec.shape.site.shape.base,
    specification_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    source_commit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    manifest_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    deployment_id: z.uuid().nullable(),
    status: astroProvisioningStatus,
    stage: astroProvisioningStage,
    attempt_count: z.number().int().positive(),
    retryable: z.boolean(),
    error_code: astroProvisioningErrorCode.nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export const instanceSpecification = z
  .object({
    contract_version: z.literal(1),
    request_id: z.uuid(),
    restaurant: provisioningSpec.shape.restaurant.omit({ id: true }).strict(),
    template: templateReleaseSchema,
    site: z
      .object({
        repository: provisioningSpec.shape.site.shape.repository,
        origin: provisioningSpec.shape.site.shape.origin,
        base: provisioningSpec.shape.site.shape.base,
      })
      .strict(),
    sanity: provisioningSpec.shape.sanity.omit({ integration_id: true }).strict(),
    visual: storedThemeSchema,
    modules,
    deployment: z
      .object({
        publication_endpoint: z.url(),
        provisioning_endpoint: z.url(),
      })
      .strict(),
  })
  .strict();

export const astroProvisioningCallback = z
  .object({
    action: z.literal('source_ready'),
    request_id: z.uuid(),
    source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type AstroProvisioningJob = z.infer<typeof astroProvisioningJob>;
export type AstroProvisioningStage = z.infer<typeof astroProvisioningStage>;
export type AstroProvisioningErrorCode = z.infer<typeof astroProvisioningErrorCode>;
export type InstanceSpecification = z.infer<typeof instanceSpecification>;
