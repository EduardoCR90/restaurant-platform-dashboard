import { z } from "zod";
import { storedThemeSchema } from "./visual.ts";

export const templateVersion = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const templateReleaseSchema = z
  .object({
    template_key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: templateVersion,
    source_commit: sha,
    distribution_hash: digest,
    configuration_contract: z.literal(1),
    content_contract: z.literal("salitre-v1"),
    visual_contract: z.literal(2),
  })
  .strict();
export type TemplateRelease = z.infer<typeof templateReleaseSchema>;
export const websiteStateSchema = z.object({
  restaurant_id: z.uuid(),
  installed_release: templateReleaseSchema.nullable(),
  desired_release: templateReleaseSchema.nullable(),
  revision: z.number().int().nonnegative(),
  verified_run_id: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .nullable(),
  verified_at: z.string().nullable(),
});
export type WebsiteState = z.infer<typeof websiteStateSchema>;
export const hostnameSchema = z
  .string()
  .max(253)
  .regex(
    /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
  )
  .refine(
    (value) => !value.endsWith(".localhost") && !value.endsWith(".local"),
  );
const origin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash
  );
});
const moduleNames = [
  "content_management",
  "reservations",
  "staff_scheduling",
  "qr_menu",
  "events",
  "analytics",
] as const;
export const provisioningSpec = z
  .object({
    contract_version: z.literal(1),
    request_id: z.uuid(),
    restaurant: z
      .object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(120),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      })
      .strict(),
    template: templateReleaseSchema,
    site: z
      .object({
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        origin,
        base: z.string().regex(/^\/(?:[A-Za-z0-9_-]+\/?)*$/),
        custom_domain: hostnameSchema.optional(),
      })
      .strict()
      .refine(
        (site) =>
          !site.custom_domain ||
          new URL(site.origin).hostname === site.custom_domain,
        "Custom domain and site origin must agree",
      ),
    sanity: z
      .object({
        integration_id: z.uuid(),
        project_id: z.string().regex(/^[a-z0-9]{1,32}$/),
        dataset: z.string().regex(/^[a-z0-9_-]{1,64}$/),
      })
      .strict(),
    visual: storedThemeSchema,
    modules: z
      .array(
        z
          .object({
            key: z.enum(moduleNames),
            granted: z.boolean(),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(moduleNames.length)
      .refine(
        (items) =>
          new Set(items.map((item) => item.key)).size === items.length &&
          items.every((item) => !item.enabled || item.granted),
        "Unique modules; activation requires entitlement",
      ),
    assignments: z
      .array(
        z
          .object({
            user_id: z.uuid(),
            role: z.enum([
              "restaurant_owner",
              "restaurant_manager",
              "restaurant_staff",
            ]),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (items) =>
          new Set(items.map((item) => item.user_id)).size === items.length,
        "Unique users",
      ),
  })
  .strict();
export type ProvisioningSpec = z.infer<typeof provisioningSpec>;
// Validation is not authorization. A future executor must authenticate Super Admin,
// re-resolve restaurant/integration/catalog IDs, verify domain ownership and persist
// idempotent progress before any resource creation. No executor ships in phase 5.
