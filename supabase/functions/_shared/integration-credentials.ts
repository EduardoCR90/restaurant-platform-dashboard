import { z } from 'zod';
import { HttpError } from '../../../shared/editor-service.ts';
import type { EnvironmentReader } from './environment.ts';

const keyVersion = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);
const encoded = z.string().regex(/^[A-Za-z0-9_-]+$/);
const encryptedCredential = z
  .object({
    ciphertext: encoded,
    iv: encoded,
    key_version: keyVersion,
  })
  .strict();

export type EncryptedCredential = z.infer<typeof encryptedCredential>;

function decode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encode(value: Uint8Array): string {
  let binary = '';
  for (const character of value) binary += String.fromCharCode(character);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export type CredentialKeyring = Readonly<{
  activeVersion: string;
  keys: ReadonlyMap<string, Uint8Array>;
}>;

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}

export function credentialKeyring(env: EnvironmentReader): CredentialKeyring {
  const activeVersion = keyVersion.safeParse(env('APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY'));
  if (!activeVersion.success)
    throw new HttpError(503, 'Cifrado de integraciones pendiente de configuración');
  let raw: unknown;
  try {
    raw = JSON.parse(env('APP_INTEGRATION_CREDENTIAL_KEYS') || '');
  } catch {
    throw new HttpError(503, 'Cifrado de integraciones pendiente de configuración');
  }
  const parsed = z.record(keyVersion, encoded).safeParse(raw);
  if (!parsed.success || !Object.hasOwn(parsed.data, activeVersion.data))
    throw new HttpError(503, 'Cifrado de integraciones pendiente de configuración');
  const keys = new Map<string, Uint8Array>();
  try {
    for (const [version, value] of Object.entries(parsed.data)) {
      const bytes = decode(value);
      if (bytes.length !== 32) throw new Error('invalid key length');
      keys.set(version, bytes);
    }
  } catch {
    throw new HttpError(503, 'Cifrado de integraciones pendiente de configuración');
  }
  return Object.freeze({ activeVersion: activeVersion.data, keys });
}

async function cryptoKey(bytes: Uint8Array, usage: KeyUsage) {
  return crypto.subtle.importKey('raw', arrayBuffer(bytes), { name: 'AES-GCM' }, false, [usage]);
}

function additionalData(integrationId: string, version: string) {
  return new TextEncoder().encode(`sanity:${z.uuid().parse(integrationId)}:${version}`);
}

export async function encryptIntegrationCredential(
  token: string,
  integrationId: string,
  keyring: CredentialKeyring,
): Promise<EncryptedCredential> {
  if (!token) throw new HttpError(503, 'Sanity no entregó una credencial utilizable');
  const bytes = keyring.keys.get(keyring.activeVersion);
  if (!bytes) throw new HttpError(503, 'Clave activa de integraciones no disponible');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: arrayBuffer(iv),
      additionalData: arrayBuffer(additionalData(integrationId, keyring.activeVersion)),
      tagLength: 128,
    },
    await cryptoKey(bytes, 'encrypt'),
    arrayBuffer(new TextEncoder().encode(token)),
  );
  return {
    ciphertext: encode(new Uint8Array(ciphertext)),
    iv: encode(iv),
    key_version: keyring.activeVersion,
  };
}

export async function decryptIntegrationCredential(
  input: unknown,
  integrationId: string,
  keyring: CredentialKeyring,
): Promise<string> {
  const value = encryptedCredential.safeParse(input);
  const bytes = value.success ? keyring.keys.get(value.data.key_version) : undefined;
  if (!value.success || !bytes) throw new HttpError(503, 'Credencial de integración no disponible');
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: arrayBuffer(decode(value.data.iv)),
        additionalData: arrayBuffer(additionalData(integrationId, value.data.key_version)),
        tagLength: 128,
      },
      await cryptoKey(bytes, 'decrypt'),
      arrayBuffer(decode(value.data.ciphertext)),
    );
    const token = new TextDecoder().decode(plaintext);
    if (!token) throw new Error('empty credential');
    return token;
  } catch {
    throw new HttpError(503, 'Credencial de integración no disponible');
  }
}

export async function resolveIntegrationCredential(
  integrationId: string,
  env: EnvironmentReader,
  readStored: (id: string) => Promise<unknown | null>,
): Promise<{ token: string; managedKeyVersion: string | null }> {
  z.uuid().parse(integrationId);
  const stored = await readStored(integrationId);
  if (stored) {
    const parsed = encryptedCredential.parse(stored);
    return {
      token: await decryptIntegrationCredential(parsed, integrationId, credentialKeyring(env)),
      managedKeyVersion: parsed.key_version,
    };
  }
  let legacy: unknown;
  try {
    legacy = JSON.parse(env('SANITY_TOKENS') || '{}');
  } catch {
    throw new HttpError(503, 'Mapa de credenciales Sanity inválido');
  }
  const token =
    typeof legacy === 'object' && legacy !== null
      ? (legacy as Record<string, unknown>)[integrationId]
      : undefined;
  if (typeof token !== 'string' || !token)
    throw new HttpError(503, 'Token de integración pendiente de configuración');
  return { token, managedKeyVersion: null };
}
