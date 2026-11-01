import { HttpError } from '../../../shared/editor-service.ts';
import { ZodError } from 'zod';
export async function limitedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Falta el cuerpo');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 12 * 1024 * 1024) {
      await reader.cancel();
      throw new HttpError(413, 'Petición demasiado grande');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}
export function handler(
  fn: (request: Request) => Promise<unknown>,
  options: { serverToServer?: boolean } = {},
) {
  return async (request: Request) => {
    const origin = request.headers.get('Origin') || '';
    const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
      ...(allowed.includes(origin)
        ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
            'Access-Control-Allow-Methods': 'POST,OPTIONS',
          }
        : {}),
    };
    if (!allowed.includes(origin) && !(options.serverToServer && !origin))
      return new Response(JSON.stringify({ error: 'Origen no permitido' }), {
        status: 403,
        headers,
      });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST')
      return new Response(JSON.stringify({ error: 'Método no permitido' }), {
        status: 405,
        headers,
      });
    try {
      return new Response(JSON.stringify(await fn(request)), { status: 200, headers });
    } catch (error) {
      const status =
        error instanceof HttpError ? error.status : error instanceof ZodError ? 422 : 500;
      const message =
        error instanceof HttpError
          ? error.message
          : error instanceof ZodError
            ? 'Revisa los campos del documento. No se ha guardado.'
            : 'No se pudo completar la operación. No se reintenta automáticamente.';
      return new Response(JSON.stringify({ error: message }), { status, headers });
    }
  };
}
