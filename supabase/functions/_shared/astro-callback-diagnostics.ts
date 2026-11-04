import { ZodError } from 'zod';
import { HttpError } from '../../../shared/editor-service.ts';
import { AstroProvisioningDatabaseError } from './astro-provisioning-service.ts';
import { GithubManagementError } from './github-management.ts';

export const astroCallbackPhases = [
  'identity',
  'state_lookup',
  'source_verification',
  'state_confirmation',
  'pages_registration',
] as const;

export type AstroCallbackPhase = (typeof astroCallbackPhases)[number];

export type AstroCallbackDiagnostic = Readonly<{
  phase: AstroCallbackPhase;
  category:
    | 'identity'
    | 'contract'
    | 'credentials'
    | 'permissions'
    | 'connection'
    | 'manifest'
    | 'database'
    | 'pages'
    | 'provider_response';
  status: number;
}>;

export function astroCallbackDiagnostic(
  phase: AstroCallbackPhase,
  error: unknown,
): AstroCallbackDiagnostic {
  if (error instanceof HttpError)
    return {
      phase,
      category: error.status === 401 || error.status === 403 ? 'identity' : 'provider_response',
      status: error.status,
    };
  if (error instanceof AstroProvisioningDatabaseError)
    return { phase, category: 'database', status: 503 };
  if (error instanceof GithubManagementError) {
    const category = ['credentials', 'permissions', 'connection', 'manifest', 'pages'].includes(
      error.code,
    )
      ? (error.code as AstroCallbackDiagnostic['category'])
      : 'provider_response';
    return {
      phase,
      category,
      status: category === 'credentials' || category === 'permissions' ? 403 : 503,
    };
  }
  if (error instanceof ZodError) return { phase, category: 'contract', status: 422 };
  return { phase, category: 'provider_response', status: 500 };
}

export function logAstroCallbackFailure(
  requestId: string | null,
  diagnostic: AstroCallbackDiagnostic,
) {
  console.error(
    JSON.stringify({
      event: 'astro-provisioning.source-ready-failed',
      component: 'astro-provisioning',
      request_id: requestId,
      phase: diagnostic.phase,
      category: diagnostic.category,
    }),
  );
}
