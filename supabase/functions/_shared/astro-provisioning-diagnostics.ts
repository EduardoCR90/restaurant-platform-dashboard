import type { AstroRepositoryValidationObservation } from './astro-provisioning-service.ts';

export type AstroRepositoryValidationLog = Readonly<{
  event: 'astro-provisioning.repository-validation';
  component: 'astro-provisioning';
  request_id: string;
}> &
  AstroRepositoryValidationObservation;

// Campos cerrados: no admite excepciones, respuestas, nombres, IDs de proveedor
// ni valores de configuración o credenciales.
export function logAstroRepositoryValidation(entry: AstroRepositoryValidationLog) {
  console.error(JSON.stringify(entry));
}
