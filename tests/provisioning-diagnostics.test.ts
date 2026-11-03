// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  logProvisioningDiagnostic,
  sanityProvisioningDiagnostics,
} from '../supabase/functions/_shared/provisioning-diagnostics';

const valid = {
  SANITY_PROVISIONER_TOKEN: 'management-token',
  SANITY_PROVISIONING_ORGANIZATION_ID: 'organization-id',
  SANITY_EXPECTED_ADMIN_USER_ID: 'platform-owner-id',
  APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY: 'v1',
  APP_INTEGRATION_CREDENTIAL_KEYS: JSON.stringify({
    v1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  }),
};
const env = (values: Record<string, string | undefined>) => (name: string) => values[name];

describe('diagnóstico seguro de configuración de aprovisionamiento', () => {
  it('exige también el cifrado backend aunque los dos secretos Sanity estén presentes', () => {
    expect(
      sanityProvisioningDiagnostics(
        env({
          SANITY_PROVISIONER_TOKEN: valid.SANITY_PROVISIONER_TOKEN,
          SANITY_PROVISIONING_ORGANIZATION_ID: valid.SANITY_PROVISIONING_ORGANIZATION_ID,
          SANITY_EXPECTED_ADMIN_USER_ID: valid.SANITY_EXPECTED_ADMIN_USER_ID,
        }),
      ),
    ).toEqual({
      ready: false,
      missing: ['APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY', 'APP_INTEGRATION_CREDENTIAL_KEYS'],
      invalid: [],
    });
  });

  it('valida el formato sin devolver valores y acepta un keyring correcto', () => {
    expect(sanityProvisioningDiagnostics(env(valid))).toEqual({
      ready: true,
      missing: [],
      invalid: [],
    });
    const result = sanityProvisioningDiagnostics(
      env({ ...valid, APP_INTEGRATION_CREDENTIAL_KEYS: '{invalid' }),
    );
    expect(result).toEqual({
      ready: false,
      missing: [],
      invalid: ['credential_keyring_invalid'],
    });
    expect(JSON.stringify(result)).not.toContain('management-token');
  });

  it('el log estructurado contiene solo categorías permitidas', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logProvisioningDiagnostic({
      event: 'provisioning.configuration',
      component: 'restaurant-provisioning',
      request_id: '01a1a200-5d67-7c2a-8d50-cdd975f97171',
      operation: 'status',
      outcome: 'rejected',
      missing: ['APP_INTEGRATION_CREDENTIAL_KEYS'],
      invalid: [],
    });
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain('APP_INTEGRATION_CREDENTIAL_KEYS');
    expect(error.mock.calls[0][0]).not.toContain('management-token');
    error.mockRestore();
  });

  it('registra el resultado de verificación sin identidad ni respuesta del proveedor', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logProvisioningDiagnostic({
      event: 'sanity-provisioning.admin-verification',
      component: 'sanity-provisioning',
      request_id: '6fa2ef1e-5427-4e04-9876-d0413843b1ea',
      outcome: 'administrator_role_missing',
    });
    const serialized = String(error.mock.calls[0][0]);
    expect(serialized).toContain('administrator_role_missing');
    expect(serialized).not.toContain('platform-owner-id');
    expect(serialized).not.toContain('management-token');
    error.mockRestore();
  });
});
