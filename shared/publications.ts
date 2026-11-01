import { z } from 'zod';
import { templateReleaseSchema } from './platform-contract.ts';
export const publicationState = z.enum([
  'publishing_sanity',
  'awaiting_deployment',
  'deploying',
  'updated',
  'sanity_error',
  'deployment_error',
]);
export const publicationSchema = z.object({
  id: z.uuid(),
  restaurant_id: z.uuid(),
  actor_id: z.uuid(),
  document_id: z.string(),
  action: z.enum(['publish', 'withdraw', 'restore']),
  state: publicationState,
  error_code: z.string().nullable(),
  created_at: z.string(),
  accepted_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  run_id: z.string().nullable(),
  run_attempt: z.number().nullable(),
});
export type Publication = z.infer<typeof publicationSchema>;
export const publicationLabels: Record<Publication['state'], string> = {
  publishing_sanity: 'Publicando en Sanity',
  awaiting_deployment: 'Publicado en Sanity, pendiente de despliegue',
  deploying: 'Despliegue en curso',
  updated: 'Web actualizada',
  sanity_error: 'Error al publicar en Sanity',
  deployment_error: 'Error al desplegar la web',
};
export const publicationErrors: Record<string, string> = {
  not_configured: 'El seguimiento de esta web necesita configuración del administrador.',
  run_not_found:
    'No se ha podido confirmar un despliegue que incluya esta publicación. Revisa el disparador antes de reconstruir la web.',
  deployment_failed:
    'La actualización de la web ha fallado. El contenido sigue guardado en Sanity.',
  deployment_expired: 'El despliegue no ha confirmado su finalización. La edición puede continuar.',
  sanity_rejected:
    'Sanity no confirmó la operación. Recarga el documento antes de intentarlo de nuevo.',
  sanity_confirmation_missing:
    'No se pudo confirmar el resultado en Sanity. Recarga y revisa antes de repetir la publicación.',
};
export async function revisionFingerprint(
  project: string,
  dataset: string,
  id: string,
  revision: string,
) {
  const bytes = new TextEncoder().encode(JSON.stringify([project, dataset, id, revision]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
const numeric = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const deploymentReportSchema = z
  .object({
    action: z.literal('deployment_report'),
    template: templateReleaseSchema.optional(),
    phase: z.enum(['building', 'ready', 'succeeded', 'failed']),
    fingerprints: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .max(10000)
      .default([]),
  })
  .strict();
export const githubClaimsSchema = z.object({
  iss: z.literal('https://token.actions.githubusercontent.com'),
  aud: z.literal('restaurant-platform-publications'),
  exp: z.number(),
  iat: z.number(),
  nbf: z.number().optional(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  repository_id: numeric,
  ref: z.literal('refs/heads/main'),
  workflow_ref: z.string(),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  run_id: numeric,
  run_attempt: numeric,
});
export type GithubClaims = z.infer<typeof githubClaimsSchema>;
