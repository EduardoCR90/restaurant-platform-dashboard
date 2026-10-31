import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { HttpError } from '../../../shared/editor-service.ts';
export async function authenticate(request: Request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer '))
    throw new HttpError(401, 'Inicia sesión para continuar');
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  if (!key) throw new HttpError(503, 'Configura la clave pública del backend');
  const client = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Verificación de identidad con Auth. Nunca decode sin verificación ni service_role para tenant.
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new HttpError(401, 'Sesión no válida o caducada');
  return { client, user: data.user };
}
export const integrationSchema = z.object({
  id: z.uuid(),
  projectId: z.string().regex(/^[a-z0-9]{1,32}$/),
  dataset: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  schema: z.literal('salitre-v1'),
});
