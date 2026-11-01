import type { SanityProvisioningRequest } from '../../../shared/sanity-provisioning.ts';

function hexadecimal(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function provisioningIdentity(
  payload: Extract<SanityProvisioningRequest, { operation: 'start' }>['payload'],
) {
  const canonical = JSON.stringify({
    contract_version: 1,
    request_id: payload.request_id,
    name: payload.name,
    slug: payload.slug,
    dataset: payload.dataset,
  });
  const digest = hexadecimal(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))),
  );
  return Object.freeze({ requestHash: digest, projectId: `r${digest.slice(0, 15)}` });
}
