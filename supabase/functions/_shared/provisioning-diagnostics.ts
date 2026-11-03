import type { EnvironmentReader } from './environment.ts';
import type {
  SanityAdminVerificationOutcome,
  SanityProvisioningErrorCode,
  SanityProvisioningStage,
} from '../../../shared/sanity-provisioning.ts';
import { credentialKeyring } from './integration-credentials.ts';
import { sanityProvisioningConfiguration } from './sanity-management.ts';

export const sanityProvisioningSecretNames = [
  'SANITY_PROVISIONER_TOKEN',
  'SANITY_PROVISIONING_ORGANIZATION_ID',
  'SANITY_EXPECTED_ADMIN_USER_ID',
  'APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY',
  'APP_INTEGRATION_CREDENTIAL_KEYS',
] as const;

export type SanityProvisioningSecretName = (typeof sanityProvisioningSecretNames)[number];
export type SanityConfigurationIssue = 'sanity_management_invalid' | 'credential_keyring_invalid';

export type SanityProvisioningDiagnostics = Readonly<{
  ready: boolean;
  missing: readonly SanityProvisioningSecretName[];
  invalid: readonly SanityConfigurationIssue[];
}>;

export function sanityProvisioningDiagnostics(
  env: EnvironmentReader,
): SanityProvisioningDiagnostics {
  const missing = sanityProvisioningSecretNames.filter((name) => !env(name)?.trim());
  const invalid: SanityConfigurationIssue[] = [];
  if (
    !missing.includes('SANITY_PROVISIONER_TOKEN') &&
    !missing.includes('SANITY_PROVISIONING_ORGANIZATION_ID') &&
    !missing.includes('SANITY_EXPECTED_ADMIN_USER_ID')
  ) {
    try {
      sanityProvisioningConfiguration(env);
    } catch {
      invalid.push('sanity_management_invalid');
    }
  }
  if (
    !missing.includes('APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY') &&
    !missing.includes('APP_INTEGRATION_CREDENTIAL_KEYS')
  ) {
    try {
      credentialKeyring(env);
    } catch {
      invalid.push('credential_keyring_invalid');
    }
  }
  return Object.freeze({
    ready: missing.length === 0 && invalid.length === 0,
    missing: Object.freeze(missing),
    invalid: Object.freeze(invalid),
  });
}

type ConfigurationLog = Readonly<{
  event: 'provisioning.configuration';
  component: 'restaurant-provisioning' | 'sanity-provisioning';
  request_id: string;
  operation: 'start' | 'retry' | 'status' | 'verify_admin' | 'verify_sanity_admin';
  outcome: 'rejected';
  missing: readonly SanityProvisioningSecretName[];
  invalid: readonly SanityConfigurationIssue[];
}>;

type SanityFailureLog = Readonly<{
  event: 'sanity-provisioning.failure';
  component: 'sanity-provisioning';
  request_id: string;
  stage: SanityProvisioningStage;
  error_code: SanityProvisioningErrorCode;
  retryable: boolean;
  manual_review: boolean;
}>;

type SanityAdminVerificationLog = Readonly<{
  event: 'sanity-provisioning.admin-verification';
  component: 'sanity-provisioning';
  request_id: string;
  outcome: SanityAdminVerificationOutcome;
}>;

export type ProvisioningDiagnosticLog =
  ConfigurationLog | SanityFailureLog | SanityAdminVerificationLog;

// Solo acepta campos tipados y categorías cerradas. Nunca recibe excepciones,
// cabeceras, cuerpos de proveedor, emails, tokens o valores de secretos.
export function logProvisioningDiagnostic(entry: ProvisioningDiagnosticLog) {
  console.error(JSON.stringify(entry));
}
