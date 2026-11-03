import { z } from 'zod';
import { astroProvisioningJob } from './astro-provisioning.ts';
import {
  hostnameSchema,
  moduleConfigurationSchema,
  moduleNames,
  provisioningSpec,
  templateReleaseSchema,
} from './platform-contract.ts';
import { sanityProvisioningJob } from './sanity-provisioning.ts';
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

export const clientRole = z.enum(['restaurant_owner', 'restaurant_manager']);
export const requestedDomain = z
  .object({ hostname: hostnameSchema, mode: z.enum(['apex', 'subdomain']) })
  .strict();

export const restaurantProvisioningRequest = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('start'),
      payload: z
        .object({
          request_id: z.uuid(),
          name: provisioningSpec.shape.restaurant.shape.name,
          slug: provisioningSpec.shape.restaurant.shape.slug,
          client_email: z.email().max(254),
          client_role: clientRole.default('restaurant_owner'),
          template: templateSelection,
          visual: storedThemeSchema.default({}),
          modules: modules.default([]),
          domain: requestedDomain.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.enum(['retry', 'status', 'verify_sanity_admin']),
      payload: z.object({ request_id: z.uuid() }).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('list'),
      payload: z.object({ limit: z.number().int().min(1).max(50).default(20) }).strict(),
    })
    .strict(),
]);

export const restaurantProvisioningStatus = z.enum([
  'running',
  'awaiting',
  'succeeded',
  'failed',
  'manual_review',
]);
export const restaurantProvisioningStage = z.enum([
  'sanity',
  'astro',
  'client_invitation',
  'completed',
]);
export const restaurantProvisioningErrorCode = z.enum([
  'configuration',
  'sanity',
  'astro',
  'invitation',
  'database',
]);

export const dnsRecord = z
  .object({
    type: z.enum(['A', 'AAAA', 'CNAME']),
    name: z.string().min(1).max(253),
    value: z.string().min(1).max(253),
  })
  .strict();
export const domainInstructions = z
  .object({
    hostname: hostnameSchema,
    mode: z.enum(['apex', 'subdomain']),
    target: hostnameSchema,
    status: z.enum(['dns_pending', 'verified']),
    records: z.array(dnsRecord).min(1).max(8),
  })
  .strict();

export const restaurantProvisioningJob = z
  .object({
    request_id: z.uuid(),
    name: provisioningSpec.shape.restaurant.shape.name,
    slug: provisioningSpec.shape.restaurant.shape.slug,
    client_email: z.email(),
    client_role: clientRole,
    template: templateSelection,
    visual: storedThemeSchema,
    modules,
    domain: requestedDomain.nullable(),
    sanity_request_id: z.uuid(),
    astro_request_id: z.uuid(),
    restaurant_id: z.uuid().nullable(),
    integration_id: z.uuid().nullable(),
    invitation_id: z.uuid().nullable(),
    client_user_id: z.uuid().nullable(),
    repository: z.string().nullable(),
    site_url: z.url().nullable(),
    status: restaurantProvisioningStatus,
    stage: restaurantProvisioningStage,
    attempt_count: z.number().int().positive(),
    retryable: z.boolean(),
    error_code: restaurantProvisioningErrorCode.nullable(),
    sanity: sanityProvisioningJob.nullable(),
    astro: astroProvisioningJob.nullable(),
    dns: domainInstructions.nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export const restaurantProvisioningList = z.array(restaurantProvisioningJob);
export type RestaurantProvisioningRequest = z.infer<typeof restaurantProvisioningRequest>;
export type RestaurantProvisioningJob = z.infer<typeof restaurantProvisioningJob>;
export type RestaurantProvisioningStage = z.infer<typeof restaurantProvisioningStage>;
export type RestaurantProvisioningErrorCode = z.infer<typeof restaurantProvisioningErrorCode>;
export type DomainInstructions = z.infer<typeof domainInstructions>;
