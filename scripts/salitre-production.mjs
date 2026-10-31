import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const project = 'wanrzgumoamryuybmopa';
const secretName = 'SALITRE_PRODUCTION_WRITE_TARGET';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const inspectQuery = `select r.id as restaurant_id,r.slug,r.status as restaurant_status,i.id as integration_id,i.provider,i.external_project_id,i.external_dataset,i.configuration->>'schema' as schema,
 exists(select 1 from public.restaurant_module_entitlements e where e.restaurant_id=r.id and e.module_key='content_management' and e.granted) as granted,
 exists(select 1 from public.restaurant_modules m where m.restaurant_id=r.id and m.module_key='content_management' and m.enabled) as enabled
 from public.restaurants r join public.restaurant_integrations i on i.restaurant_id=r.id
 where r.slug='salitre' and i.provider='sanity';`;
export function targetFromRows(rows) {
  assert.ok(
    Array.isArray(rows) && rows.length === 1,
    'Se requiere exactamente una integración existente de Salitre',
  );
  const row = rows[0];
  assert.ok(uuid.test(row.restaurant_id) && uuid.test(row.integration_id), 'UUID inválido');
  assert.equal(row.slug, 'salitre');
  assert.equal(row.provider, 'sanity');
  assert.equal(row.external_project_id, 'hfa8zkyw');
  assert.ok(
    ['staging', 'production'].includes(row.external_dataset),
    'Dataset inesperado: revisar sin sobrescribir',
  );
  assert.equal(row.schema, 'salitre-v1');
  assert.equal(row.restaurant_status, 'active');
  assert.equal(row.granted, true);
  assert.equal(row.enabled, true);
  return {
    restaurantId: row.restaurant_id,
    integrationId: row.integration_id,
    projectId: 'hfa8zkyw',
    dataset: 'production',
  };
}
export function updateQuery(target) {
  // Solo UUID validados y constantes; no SQL o destinos arbitrarios desde inputs.
  assert.ok(uuid.test(target.restaurantId) && uuid.test(target.integrationId));
  return `do $$ declare affected integer; begin
 perform 1 from public.restaurants r join public.restaurant_integrations i on i.restaurant_id=r.id where r.id='${target.restaurantId}'::uuid and r.slug='salitre' and r.status='active' and i.id='${target.integrationId}'::uuid and i.provider='sanity' and i.external_project_id='hfa8zkyw' and i.external_dataset in ('staging','production') and i.configuration='{"schema":"salitre-v1"}'::jsonb for update of r,i;
 if not found then raise exception 'Integracion cambiada: no se actualiza'; end if;
 update public.restaurant_integrations set external_dataset='production' where id='${target.integrationId}'::uuid and restaurant_id='${target.restaurantId}'::uuid and provider='sanity' and external_project_id='hfa8zkyw' and external_dataset in ('staging','production');
 get diagnostics affected=row_count; if affected<>1 then raise exception 'No se actualizo exactamente una integracion'; end if;
 end $$;`;
}
export function verifyPolicyMetadata(entry, target) {
  if (!entry) return { matches: false, format: 'absent' };
  const canonical = JSON.stringify(target);
  for (const field of ['digest', 'value']) {
    const fingerprint = entry[field];
    if (typeof fingerprint !== 'string') continue;
    // Solo la política de UUIDs: nunca se inspecciona el valor de SANITY_TOKENS.
    if (fingerprint === canonical) return { matches: true, format: field + '-configuration' };
    for (const algorithm of ['sha256', 'sha1', 'md5']) {
      const expected = createHash(algorithm).update(canonical).digest('hex');
      if (fingerprint.toLowerCase() === expected)
        return { matches: true, format: field + '-' + algorithm };
    }
  }
  return { matches: false, format: 'different-or-unsupported' };
}
class ConfigurationFailure extends Error {
  constructor(phase) {
    super(
      `Configuración detenida en fase ${phase}. No se sobrescribe ni se reintenta; revisar mediante inspect.`,
    );
  }
}
export async function configureSalitre(
  { operation, expectedRestaurant, expectedIntegration, confirmation },
  api,
) {
  let phase = 'inspect-integration';
  try {
    const current = await api('database/query', {
      method: 'POST',
      body: { query: inspectQuery, read_only: true },
    });
    const target = targetFromRows(current);
    phase = 'inspect-policy';
    const list = await api('secrets');
    assert.ok(Array.isArray(list));
    const existing = list.find((s) => s.name === secretName);
    const verification = verifyPolicyMetadata(existing, target);
    const hasSanityTokens = list.some((s) => s.name === 'SANITY_TOKENS');
    if (operation === 'inspect')
      return {
        status: 'inspected-read-only',
        currentDataset: current[0].external_dataset,
        ...target,
        hasSanityTokens,
        policyPresent: !!existing,
        policyMatchesTarget: verification.matches,
        policyMetadataFormat: verification.format,
      };
    phase = 'validate-authorization';
    assert.equal(operation, 'apply');
    assert.equal(confirmation, 'HABILITAR SALITRE PRODUCTION');
    assert.equal(target.restaurantId, expectedRestaurant);
    assert.equal(target.integrationId, expectedIntegration);
    phase = 'validate-token-presence';
    assert.ok(hasSanityTokens);
    const value = JSON.stringify(target);
    phase = 'verify-existing-policy';
    if (existing) assert.ok(verification.matches);
    else {
      phase = 'create-policy';
      await api('secrets', { method: 'POST', body: [{ name: secretName, value }] });
    }
    phase = 'verify-policy';
    const verified = await api('secrets');
    assert.ok(
      verifyPolicyMetadata(
        verified.find((s) => s.name === secretName),
        target,
      ).matches,
    );
    phase = 'update-integration';
    if (current[0].external_dataset !== 'production')
      await api('database/query', {
        method: 'POST',
        body: { query: updateQuery(target), read_only: false },
      });
    phase = 'verify-integration';
    const after = await api('database/query', {
      method: 'POST',
      body: { query: inspectQuery, read_only: true },
    });
    assert.deepEqual(targetFromRows(after), target);
    assert.equal(after[0].external_dataset, 'production');
    return { status: 'configured-no-content-written', ...target };
  } catch (error) {
    if (error?.message?.startsWith('Gestión Supabase rechazada (HTTP ')) throw error;
    throw new ConfigurationFailure(phase);
  }
}
export function managementApi(token, request = fetch) {
  assert.ok(typeof token === 'string' && token.trim(), 'Falta credencial de gestión');
  return async (path, options = {}) => {
    assert.ok(['database/query', 'secrets'].includes(path));
    const response = await request(`https://api.supabase.com/v1/projects/${project}/${path}`, {
      method: options.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `Gestión Supabase rechazada (HTTP ${response.status}); no se imprime la respuesta privada`,
      );
    if (response.status === 204) return null;
    return response.json();
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
    assert.equal(process.env.GITHUB_REPOSITORY, 'EduardoCR90/restaurant-platform-dashboard');
    assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
    const result = await configureSalitre(
      {
        operation: process.env.SALITRE_OPERATION,
        expectedRestaurant: process.env.EXPECTED_RESTAURANT_ID,
        expectedIntegration: process.env.EXPECTED_INTEGRATION_ID,
        confirmation: process.env.SALITRE_CONFIRMATION,
      },
      managementApi(process.env.SUPABASE_ACCESS_TOKEN),
    );
    // Solo identidad no secreta y dataset; nunca valores/digests de secretos o filas completas.
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      error instanceof ConfigurationFailure
        ? error.message
        : error?.message?.startsWith('Gestión Supabase rechazada (HTTP ')
          ? error.message
          : 'Configuración detenida: revisar identidad, permisos y política existente. No se muestran respuestas privadas ni se reintenta.',
    );
    process.exitCode = 1;
  }
}
