import type { RestaurantProvisioningRequest } from '../../../shared/restaurant-provisioning.ts';
import { astroRequestHash, sha256 } from './astro-provisioning-request.ts';

function uuidFromDigest(digest: string) {
  const bytes = digest.slice(0, 32).split('');
  bytes[12] = '4';
  bytes[16] = ['8', '9', 'a', 'b'][Number.parseInt(bytes[16], 16) % 4];
  const value = bytes.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function restaurantProvisioningIdentity(
  payload: Extract<RestaurantProvisioningRequest, { operation: 'start' }>['payload'],
) {
  const requestHash = await astroRequestHash({ contract_version: 1, ...payload });
  const sanityDigest = await sha256(`${payload.request_id}:sanity`);
  const astroDigest = await sha256(`${payload.request_id}:astro`);
  return Object.freeze({
    requestHash,
    sanityRequestId: uuidFromDigest(sanityDigest),
    astroRequestId: uuidFromDigest(astroDigest),
  });
}
