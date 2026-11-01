// @vitest-environment node
import { beforeAll, it, expect } from 'vitest';
import { verifyGithubIdentity } from '../shared/github-oidc';
let pair: CryptoKeyPair, jwks: { keys: (JsonWebKey & { kid: string })[] };
const claims = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'restaurant-platform-publications',
  iat: Date.now() / 1000,
  exp: Date.now() / 1000 + 300,
  repository: 'owner/web',
  repository_id: '123',
  ref: 'refs/heads/main',
  workflow_ref: 'owner/web/.github/workflows/deploy.yml@refs/heads/main',
  sha: 'a'.repeat(40),
  run_id: '12345',
  run_attempt: '1',
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
beforeAll(async () => {
  pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  jwks = { keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test' }] };
});
async function token(overrides: Record<string, unknown> = {}) {
  const body = encode({ alg: 'RS256', kid: 'test' }) + '.' + encode({ ...claims, ...overrides });
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    pair.privateKey,
    new TextEncoder().encode(body),
  );
  return body + '.' + Buffer.from(signature).toString('base64url');
}
it('verifica firma criptográfica e identidad de un workflow main', async () => {
  expect(await verifyGithubIdentity(await token(), jwks)).toMatchObject({
    run_id: '12345',
    repository_id: '123',
  });
});
it.each([
  { aud: 'wrong' },
  { iss: 'https://attacker.test' },
  { ref: 'refs/pull/1/merge' },
  { workflow_ref: 'owner/web/.github/workflows/other.yml@refs/heads/main' },
  { exp: 0 },
  { iat: Date.now() / 1000 + 3600 },
  { nbf: Date.now() / 1000 + 3600 },
])('rechaza claims fuera del alcance autorizado %j', async (overrides) => {
  await expect(verifyGithubIdentity(await token(overrides), jwks)).rejects.toMatchObject({
    status: 401,
  });
});
it('no acepta decode sin firma, claves distintas ni alg none', async () => {
  await expect(
    verifyGithubIdentity(encode({ alg: 'none' }) + '.' + encode(claims) + '.fake', jwks),
  ).rejects.toMatchObject({ status: 401 });
  await expect(verifyGithubIdentity(await token(), { keys: [] })).rejects.toMatchObject({
    status: 401,
  });
  const signed = await token();
  const [header, body, sig] = signed.split('.');
  await expect(
    verifyGithubIdentity(
      header + '.' + encode({ ...claims, repository: 'other/web' }) + '.' + sig,
      jwks,
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(body).toBeTruthy();
});
