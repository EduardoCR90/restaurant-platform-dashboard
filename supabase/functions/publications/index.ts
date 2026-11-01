import { z } from 'zod';
import { authenticate } from '../_shared/auth.ts';
import { handler, limitedJson } from '../_shared/http.ts';
import { publicationAdmin, checkDatabase } from '../_shared/publications.ts';
import { verifyGithubIdentity } from '../../../shared/github-oidc.ts';
import { deploymentReportSchema } from '../../../shared/publications.ts';
import { HttpError } from '../../../shared/editor-service.ts';
let cachedKeys: { expires: number; keys: { keys: (JsonWebKey & { kid?: string })[] } } | undefined;
async function githubKeys() {
  if (cachedKeys && cachedKeys.expires > Date.now()) return cachedKeys.keys;
  try {
    const response = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks', {
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error();
    const keys = (await response.json()) as { keys: JsonWebKey[] };
    if (!Array.isArray(keys.keys)) throw new Error();
    cachedKeys = { expires: Date.now() + 60000, keys };
    return keys;
  } catch {
    throw new HttpError(503, 'No se pudo verificar la comunicación con GitHub');
  }
}
Deno.serve(
  handler(
    async (request) => {
      const input = await limitedJson(request);
      if (
        typeof input === 'object' &&
        input !== null &&
        'action' in input &&
        input.action === 'deployment_report'
      ) {
        const report = deploymentReportSchema.parse(input);
        const auth = request.headers.get('Authorization');
        if (!auth?.startsWith('Bearer '))
          throw new HttpError(401, 'Falta la identidad del workflow');
        const claims = await verifyGithubIdentity(auth.slice(7), await githubKeys());
        const db = publicationAdmin();
        const { data: target, error } = await db
          .from('website_deployments')
          .select('id')
          .eq('repository', claims.repository)
          .eq('repository_id', claims.repository_id)
          .eq('enabled', true)
          .maybeSingle();
        checkDatabase(error);
        if (!target) throw new HttpError(403, 'Workflow no autorizado para esta web');
        const recorded = await db.rpc('report_website_deployment', {
          target: target.id,
          run: claims.run_id,
          attempt: Number(claims.run_attempt),
          sha: claims.sha,
          phase: report.phase,
          hashes: [...new Set(report.fingerprints)].sort(),
        });
        checkDatabase(recorded.error);
        return { recorded: true, deployRequired: recorded.data !== false };
      }
      const { client } = await authenticate(request);
      const query = z
        .object({
          action: z.literal('list'),
          restaurantId: z.uuid(),
          documentId: z.string().max(200).optional(),
        })
        .strict()
        .parse(input);
      // Permisos frescos antes de usar el cliente privilegiado de metadatos.
      const authorization = await client.rpc('authorize_content', {
        restaurant: query.restaurantId,
      });
      if (authorization.error) throw new HttpError(403, 'Sin autorización editorial');
      const db = publicationAdmin();
      const { data: configs, error } = await db
        .from('website_deployments')
        .select('id')
        .eq('restaurant_id', query.restaurantId);
      checkDatabase(error);
      for (const config of configs || [])
        checkDatabase((await db.rpc('reconcile_publications', { target: config.id })).error);
      checkDatabase(
        (
          await db
            .from('publication_operations')
            .update({ state: 'sanity_error', error_code: 'sanity_confirmation_missing' })
            .eq('restaurant_id', query.restaurantId)
            .eq('state', 'publishing_sanity')
            .lt('created_at', new Date(Date.now() - 120000).toISOString())
        ).error,
      );
      let rows = client
        .from('publication_operations')
        .select(
          'id,restaurant_id,actor_id,document_id,action,state,error_code,created_at,accepted_at,completed_at,run_id,run_attempt',
        )
        .eq('restaurant_id', query.restaurantId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (query.documentId) rows = rows.eq('document_id', query.documentId);
      const result = await rows;
      checkDatabase(result.error);
      return result.data;
    },
    { serverToServer: true },
  ),
);
