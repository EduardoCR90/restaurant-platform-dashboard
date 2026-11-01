import { githubClaimsSchema, type GithubClaims } from './publications.ts';
import { HttpError } from './editor-service.ts';
function decode(part: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
export async function verifyGithubIdentity(
  token: string,
  keys: { keys: (JsonWebKey & { kid?: string })[] },
  now = Date.now(),
): Promise<GithubClaims> {
  try {
    if (token.length > 16000) throw new Error();
    const [headerPart, payloadPart, signature, extra] = token.split('.');
    if (!headerPart || !payloadPart || !signature || extra) throw new Error();
    const header = JSON.parse(new TextDecoder().decode(decode(headerPart))) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256' || !header.kid) throw new Error();
    const key = keys.keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
    if (!key) throw new Error();
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    if (
      !(await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        publicKey,
        decode(signature),
        new TextEncoder().encode(`${headerPart}.${payloadPart}`),
      ))
    )
      throw new Error();
    const claims = githubClaimsSchema.parse(
      JSON.parse(new TextDecoder().decode(decode(payloadPart))),
    );
    const seconds = now / 1000;
    if (
      claims.exp <= seconds ||
      claims.iat > seconds + 30 ||
      claims.iat < seconds - 600 ||
      (claims.nbf ?? 0) > seconds + 30
    )
      throw new Error();
    if (claims.workflow_ref !== `${claims.repository}/.github/workflows/deploy.yml@refs/heads/main`)
      throw new Error();
    return claims;
  } catch {
    throw new HttpError(401, 'Identidad del workflow no válida');
  }
}
