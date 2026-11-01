// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  credentialKeyring,
  decryptIntegrationCredential,
  encryptIntegrationCredential,
  resolveIntegrationCredential,
} from '../supabase/functions/_shared/integration-credentials';

const integrationId = '00000000-0000-4000-8000-000000000001';
const key = Buffer.alloc(32, 7).toString('base64url');
const env = (values: Record<string, string | undefined>) => (name: string) => values[name];

describe('credenciales cifradas de integraciones', () => {
  it('cifra con AES-GCM y vincula el secreto al UUID y versión de clave', async () => {
    const ring = credentialKeyring(
      env({
        APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY: 'v1',
        APP_INTEGRATION_CREDENTIAL_KEYS: JSON.stringify({ v1: key }),
      }),
    );
    const encrypted = await encryptIntegrationCredential('secret-token', integrationId, ring);
    expect(JSON.stringify(encrypted)).not.toContain('secret-token');
    await expect(decryptIntegrationCredential(encrypted, integrationId, ring)).resolves.toBe(
      'secret-token',
    );
    await expect(
      decryptIntegrationCredential(encrypted, '00000000-0000-4000-8000-000000000002', ring),
    ).rejects.toThrow('Credencial de integración no disponible');
  });

  it('falla cerrado si la clave activa falta o no tiene 32 bytes', () => {
    for (const values of [
      { APP_INTEGRATION_CREDENTIAL_KEYS: JSON.stringify({ v1: key }) },
      {
        APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY: 'v1',
        APP_INTEGRATION_CREDENTIAL_KEYS: JSON.stringify({ v1: 'c2hvcnQ' }),
      },
    ])
      expect(() => credentialKeyring(env(values))).toThrow(/Cifrado de integraciones/);
  });

  it('prefiere el almacén cifrado y conserva el mapa heredado para Salitre', async () => {
    const ringValues = {
      APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY: 'v1',
      APP_INTEGRATION_CREDENTIAL_KEYS: JSON.stringify({ v1: key }),
      SANITY_TOKENS: JSON.stringify({ [integrationId]: 'legacy-token' }),
    };
    const encrypted = await encryptIntegrationCredential(
      'stored-token',
      integrationId,
      credentialKeyring(env(ringValues)),
    );
    await expect(
      resolveIntegrationCredential(integrationId, env(ringValues), async () => encrypted),
    ).resolves.toEqual({ token: 'stored-token', managedKeyVersion: 'v1' });
    await expect(
      resolveIntegrationCredential(integrationId, env(ringValues), async () => null),
    ).resolves.toEqual({ token: 'legacy-token', managedKeyVersion: null });
  });

  it('no expone el contenido de mapas o claves inválidas', async () => {
    const sensitive = 'private-sensitive-value';
    await expect(
      resolveIntegrationCredential(
        integrationId,
        env({ SANITY_TOKENS: `{${sensitive}` }),
        async () => null,
      ),
    ).rejects.not.toThrow(sensitive);
  });
});
