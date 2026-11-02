import { HttpError } from '../../../shared/editor-service.ts';

let cachedKeys: { expires: number; keys: { keys: (JsonWebKey & { kid?: string })[] } } | undefined;

export async function githubKeys(fetcher: typeof fetch = fetch) {
  if (cachedKeys && cachedKeys.expires > Date.now()) return cachedKeys.keys;
  try {
    const response = await fetcher('https://token.actions.githubusercontent.com/.well-known/jwks', {
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error();
    const keys = (await response.json()) as { keys: JsonWebKey[] };
    if (!Array.isArray(keys.keys)) throw new Error();
    cachedKeys = { expires: Date.now() + 60000, keys };
    return keys;
  } catch {
    throw new HttpError(503, 'No se pudo verificar la comunicación con GitHub');
  }
}
