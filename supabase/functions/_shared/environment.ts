import { z } from 'zod';
import { HttpError } from '../../../shared/editor-service.ts';

export type EnvironmentReader = (name: string) => string | undefined;

function automaticKey(env: EnvironmentReader, name: string): string | undefined {
  const raw = env(name);
  if (!raw) return undefined;
  try {
    const keys = z.record(z.string(), z.string()).parse(JSON.parse(raw));
    // Nunca elegimos una clave de otro nombre implícitamente.
    return keys.default || undefined;
  } catch {
    // No incluir el valor ni el error de parseo (podrían contener credenciales).
    throw new HttpError(503, 'Diccionario de claves automáticas de Supabase inválido');
  }
}

function url(env: EnvironmentReader): string {
  const result = z.url().safeParse(env('SUPABASE_URL'));
  if (!result.success) throw new HttpError(503, 'URL de Supabase pendiente de configuración');
  return result.data;
}

function legacyRole(key: string): unknown {
  try {
    const payload = key.split('.')[1];
    if (!payload) return undefined;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    return typeof decoded === 'object' && decoded !== null && 'role' in decoded
      ? decoded.role
      : undefined;
  } catch {
    return undefined;
  }
}

export function publicSupabaseConfiguration(env: EnvironmentReader) {
  const key =
    env('APP_SUPABASE_PUBLISHABLE_KEY')?.trim() ||
    automaticKey(env, 'SUPABASE_PUBLISHABLE_KEYS') ||
    env('SUPABASE_ANON_KEY');
  // Solo comprueba el tipo de configuración; NO autentica a nadie decodificando JWT.
  // La identidad de cada usuario se sigue verificando con Auth.getUser.
  if (!key || (!key.startsWith('sb_publishable_') && legacyRole(key) !== 'anon'))
    throw new HttpError(503, 'Configura una clave pública válida del backend');
  return { url: url(env), key };
}

export function adminSupabaseConfiguration(env: EnvironmentReader) {
  const key = automaticKey(env, 'SUPABASE_SECRET_KEYS') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || (!key.startsWith('sb_secret_') && legacyRole(key) !== 'service_role'))
    throw new HttpError(503, 'Administración no configurada con una clave de backend válida');
  return { url: url(env), key };
}
