// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  publicSupabaseConfiguration,
  adminSupabaseConfiguration,
} from '../supabase/functions/_shared/environment';

const url = 'https://example.supabase.co';
const read = (values: Record<string, string | undefined>) => (name: string) => values[name];
const legacy = (role: string) =>
  `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test-signature`;

describe('Configuración de claves Edge, sin secretos reales', () => {
  it('usa el override permitido APP_ y no necesita un secreto SUPABASE_ personalizado', () => {
    const config = publicSupabaseConfiguration(
      read({
        SUPABASE_URL: url,
        APP_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_explicit-test',
        SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_automatic-test' }),
      }),
    );
    expect(config).toEqual({ url, key: 'sb_publishable_explicit-test' });
  });

  it('usa el default del diccionario publishable inyectado automáticamente', () => {
    expect(
      publicSupabaseConfiguration(
        read({
          SUPABASE_URL: url,
          APP_SUPABASE_PUBLISHABLE_KEY: '',
          SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
            named: 'sb_publishable_other',
            default: 'sb_publishable_default-test',
          }),
        }),
      ).key,
    ).toBe('sb_publishable_default-test');
  });

  it('conserva compatibilidad con anon heredada, nunca con service_role', () => {
    expect(
      publicSupabaseConfiguration(read({ SUPABASE_URL: url, SUPABASE_ANON_KEY: legacy('anon') }))
        .key,
    ).toBe(legacy('anon'));
    expect(() =>
      publicSupabaseConfiguration(
        read({
          SUPABASE_URL: url,
          SUPABASE_SERVICE_ROLE_KEY: legacy('service_role'),
          SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_private-test' }),
        }),
      ),
    ).toThrow(/clave pública/);
  });

  it('no depende de la antigua variable singular ni selecciona claves con nombre arbitrario', () => {
    for (const values of [
      { SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_old' },
      { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ named: 'sb_publishable_named' }) },
    ])
      expect(() => publicSupabaseConfiguration(read({ SUPABASE_URL: url, ...values }))).toThrow(
        /clave pública/,
      );
  });

  it.each(['sb_secret_private-test', legacy('service_role')])(
    'rechaza clave privilegiada mal configurada como pública (%#)',
    (key) => {
      expect(() =>
        publicSupabaseConfiguration(
          read({
            SUPABASE_URL: url,
            APP_SUPABASE_PUBLISHABLE_KEY: key,
            SUPABASE_ANON_KEY: legacy('anon'),
          }),
        ),
      ).toThrow(/clave pública/);
    },
  );

  it('JSON corrupto falla cerrado sin volcar su contenido ni recurrir a otra clave', () => {
    expect(() =>
      publicSupabaseConfiguration(
        read({
          SUPABASE_URL: url,
          SUPABASE_PUBLISHABLE_KEYS: 'malformed-sensitive-content',
          SUPABASE_ANON_KEY: legacy('anon'),
        }),
      ),
    ).toThrow('Diccionario de claves automáticas de Supabase inválido');
    expect(() =>
      adminSupabaseConfiguration(
        read({ SUPABASE_URL: url, SUPABASE_SECRET_KEYS: 'malformed-sensitive-content' }),
      ),
    ).toThrow('Diccionario de claves automáticas de Supabase inválido');
  });

  it('la administración admite secret default y service_role heredada exclusivamente en backend', () => {
    expect(
      adminSupabaseConfiguration(
        read({
          SUPABASE_URL: url,
          SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_admin-test' }),
        }),
      ).key,
    ).toBe('sb_secret_admin-test');
    expect(
      adminSupabaseConfiguration(
        read({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: legacy('service_role') }),
      ).key,
    ).toBe(legacy('service_role'));
    expect(() =>
      adminSupabaseConfiguration(
        read({
          SUPABASE_URL: url,
          SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_publishable_wrong' }),
        }),
      ),
    ).toThrow(/Administración no configurada/);
  });
});
