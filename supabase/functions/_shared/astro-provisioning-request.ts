import {
  astroProvisioningJob,
  instanceSpecification,
  type AstroProvisioningJob,
  type InstanceSpecification,
} from '../../../shared/astro-provisioning.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function astroRequestHash(value: unknown) {
  return sha256(JSON.stringify(canonical(value)));
}

export function repositoryName(slug: string) {
  const value = `${slug}-restaurant`;
  if (value.length <= 100) return value;
  return `${slug.slice(0, 89).replace(/-+$/, '')}-restaurant`;
}

export function instanceSpec(
  input: AstroProvisioningJob,
  endpoints: { publication: string; provisioning: string },
): InstanceSpecification {
  const job = astroProvisioningJob.parse(input);
  const origin = new URL(job.site_url).origin + '/';
  return instanceSpecification.parse({
    contract_version: 1,
    request_id: job.request_id,
    restaurant: { name: job.name, slug: job.slug },
    template: job.template,
    site: { repository: job.repository, origin, base: job.base_path },
    sanity: { project_id: job.project_id, dataset: job.dataset },
    visual: job.visual,
    modules: job.modules,
    deployment: {
      publication_endpoint: endpoints.publication,
      provisioning_endpoint: endpoints.provisioning,
    },
  });
}

export async function encodedSpecification(specification: InstanceSpecification) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(instanceSpecification.parse(specification)),
  );
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    hash: await sha256(bytes),
    base64url: btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    bytes,
  };
}
