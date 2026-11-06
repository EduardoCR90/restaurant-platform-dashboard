import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const project = 'wanrzgumoamryuybmopa';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const restaurantSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const requiredSanitySecrets = [
  'SANITY_PROVISIONER_TOKEN',
  'SANITY_PROVISIONING_ORGANIZATION_ID',
  'SANITY_EXPECTED_ADMIN_USER_ID',
  'APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY',
  'APP_INTEGRATION_CREDENTIAL_KEYS',
];

export function diagnosticQuery(selector, correlation) {
  const requestId = typeof selector === 'string' ? selector : selector?.requestId;
  const slug = typeof selector === 'object' ? selector?.restaurantSlug : undefined;
  assert.notEqual(Boolean(requestId), Boolean(slug));
  if (requestId) assert.match(requestId, uuid);
  if (slug) assert.match(slug, restaurantSlug);
  const fallback = correlation
    ? (() => {
        const failedAt = new Date(correlation.failedAtUtc);
        assert.ok(Number.isFinite(failedAt.getTime()));
        return ` or (r.status='failed' and r.stage='sanity' and r.error_code='configuration' and r.updated_at between '${failedAt.toISOString()}'::timestamptz-interval '10 minutes' and '${failedAt.toISOString()}'::timestamptz+interval '10 minutes')`;
      })()
    : '';
  const where = requestId
    ? `(r.request_id='${requestId}'::uuid or r.sanity_request_id='${requestId}'::uuid${fallback})`
    : `exists(select 1 from public.restaurants target_restaurant where target_restaurant.id=r.restaurant_id and target_restaurant.slug='${slug}')`;
  const order = requestId
    ? `case when r.request_id='${requestId}'::uuid or r.sanity_request_id='${requestId}'::uuid then 0 else 1 end,abs(extract(epoch from r.updated_at-'${correlation ? new Date(correlation.failedAtUtc).toISOString() : '1970-01-01T00:00:00.000Z'}'::timestamptz))`
    : 'r.created_at desc';
  return `select r.request_id,r.status,r.stage,r.error_code,r.retryable,r.attempt_count,r.sanity_request_id,r.updated_at,
 s.request_id as child_request_id,s.status as child_status,s.stage as child_stage,s.error_code as child_error_code,s.retryable as child_retryable,s.attempt_count as child_attempt_count,s.updated_at as child_updated_at,
 a.request_id as astro_request_id,a.status as astro_status,a.stage as astro_stage,a.error_code as astro_error_code,a.retryable as astro_retryable,a.attempt_count as astro_attempt_count,a.repository,a.repository_id,a.specification_hash,a.source_commit,a.manifest_hash,a.deployment_id,a.lease_expires_at>now() as astro_has_active_lease,
 (select count(*) from public.website_deployments d where d.restaurant_id=a.restaurant_id) as existing_deployment_count,
 exists(select 1 from public.restaurant_websites w where w.restaurant_id=a.restaurant_id) as website_exists,
 (select count(*) from public.restaurant_module_entitlements e where e.restaurant_id=a.restaurant_id) as entitlement_count,
 (select count(*) from public.restaurant_modules m where m.restaurant_id=a.restaurant_id) as module_count,
 a.updated_at as astro_updated_at
 from public.restaurant_provisioning_jobs r
 left join public.sanity_provisioning_jobs s on s.request_id=r.sanity_request_id
 left join public.astro_provisioning_jobs a on a.request_id=r.astro_request_id
 where ${where}
 order by ${order}
 limit 1`;
}

export class DiagnosticFailure extends Error {
  constructor(phase) {
    super(`Diagnóstico detenido en fase ${phase}; no se muestran datos privados.`);
    this.phase = phase;
  }
}

const callbackPhases = new Set([
  'identity',
  'state_lookup',
  'source_verification',
  'state_confirmation',
  'pages_registration',
]);
const callbackCategories = new Set([
  'identity',
  'contract',
  'credentials',
  'permissions',
  'connection',
  'manifest',
  'database',
  'pages',
  'provider_response',
]);

export function edgeLogQuery(failedAtUtc) {
  const failedAt = new Date(failedAtUtc);
  assert.ok(Number.isFinite(failedAt.getTime()));
  return {
    sql: `select timestamp,event_message from edge_logs where event_message like '%astro-provisioning.source-ready-failed%' order by timestamp desc limit 20`,
    iso_timestamp_start: new Date(failedAt.getTime() - 5 * 60_000).toISOString(),
    iso_timestamp_end: new Date(failedAt.getTime() + 5 * 60_000).toISOString(),
  };
}

export function safeCallbackDiagnostic(input) {
  const rows = Array.isArray(input?.result) ? input.result : [];
  for (const row of rows) {
    if (!row || typeof row.event_message !== 'string') continue;
    const start = row.event_message.indexOf('{');
    const end = row.event_message.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const value = JSON.parse(row.event_message.slice(start, end + 1));
      if (
        value?.event === 'astro-provisioning.source-ready-failed' &&
        typeof value.request_id === 'string' &&
        uuid.test(value.request_id) &&
        callbackPhases.has(value.phase) &&
        callbackCategories.has(value.category)
      )
        return {
          request_id: value.request_id,
          phase: value.phase,
          category: value.category,
        };
    } catch {
      // Provider formatting and unrelated log lines are intentionally ignored.
    }
  }
  return null;
}

export async function diagnoseProvisioning(selector, api, correlation) {
  let secretEntries;
  try {
    secretEntries = await api('secrets');
  } catch {
    throw new DiagnosticFailure('secret_names');
  }
  let rows;
  try {
    rows = await api('database/query', {
      method: 'POST',
      body: { query: diagnosticQuery(selector, correlation), read_only: true },
    });
  } catch {
    throw new DiagnosticFailure('request_state');
  }
  let callbackDiagnostic = null;
  let edgeLogsAvailable = correlation ? false : null;
  if (correlation) {
    try {
      callbackDiagnostic = safeCallbackDiagnostic(
        await api('edge-logs', { method: 'POST', body: edgeLogQuery(correlation.failedAtUtc) }),
      );
      edgeLogsAvailable = true;
    } catch {
      edgeLogsAvailable = false;
    }
  }
  if (!Array.isArray(secretEntries)) throw new DiagnosticFailure('secret_names_shape');
  const names = new Set(
    secretEntries.flatMap((entry) =>
      entry && typeof entry === 'object' && typeof entry.name === 'string' ? [entry.name] : [],
    ),
  );
  const configured = Object.fromEntries(
    requiredSanitySecrets.map((name) => [name, names.has(name)]),
  );
  const missing = requiredSanitySecrets.filter((name) => !names.has(name));
  if (!Array.isArray(rows)) throw new DiagnosticFailure('request_state_shape');
  if (rows.length === 0)
    return {
      configured,
      missing,
      aggregate: null,
      sanity_child: null,
      astro_child: null,
      astro_callback_diagnostic: callbackDiagnostic,
      edge_logs_available: edgeLogsAvailable,
      conclusion: missing.length
        ? 'missing_required_secrets'
        : 'request_not_found_with_required_secret_names_present',
    };
  if (rows.length !== 1) throw new DiagnosticFailure('request_lookup_ambiguous');
  const row = rows[0];
  const aggregate = {
    request_id: row.request_id,
    status: row.status,
    stage: row.stage,
    error_code: row.error_code,
    retryable: row.retryable,
    attempt_count: row.attempt_count,
    updated_at: row.updated_at,
  };
  const child = row.child_request_id
    ? {
        request_id: row.child_request_id,
        status: row.child_status,
        stage: row.child_stage,
        error_code: row.child_error_code,
        retryable: row.child_retryable,
        attempt_count: row.child_attempt_count,
        updated_at: row.child_updated_at,
      }
    : null;
  const astro = row.astro_request_id
    ? {
        request_id: row.astro_request_id,
        status: row.astro_status,
        stage: row.astro_stage,
        error_code: row.astro_error_code,
        retryable: row.astro_retryable,
        attempt_count: row.astro_attempt_count,
        repository: row.repository,
        repository_id: row.repository_id,
        specification_hash: row.specification_hash,
        source_commit: row.source_commit,
        manifest_hash: row.manifest_hash,
        deployment_id: row.deployment_id,
        has_active_lease: row.astro_has_active_lease,
        existing_deployment_count: Number(row.existing_deployment_count),
        website_exists: row.website_exists,
        entitlement_count: Number(row.entitlement_count),
        module_count: Number(row.module_count),
        updated_at: row.astro_updated_at,
      }
    : null;
  const conclusion =
    aggregate.error_code === 'configuration' && missing.length
      ? 'missing_required_secrets'
      : aggregate.error_code === 'configuration' && child === null
        ? 'runtime_visibility_or_secret_validation_requires_review'
        : child
          ? 'sanity_child_started'
          : 'state_requires_review';
  return {
    configured,
    missing,
    aggregate,
    sanity_child: child,
    astro_child: astro,
    astro_callback_diagnostic: callbackDiagnostic,
    edge_logs_available: edgeLogsAvailable,
    conclusion,
  };
}

export function managementApi(token, request = fetch) {
  assert.ok(typeof token === 'string' && token.trim(), 'Falta credencial de gestión');
  return async (path, options = {}) => {
    assert.ok(['database/query', 'secrets', 'edge-logs'].includes(path));
    const endpoint = path === 'edge-logs' ? 'analytics/endpoints/logs.all' : path;
    const query =
      path === 'edge-logs'
        ? `?${new URLSearchParams({
            sql: options.body.sql,
            iso_timestamp_start: options.body.iso_timestamp_start,
            iso_timestamp_end: options.body.iso_timestamp_end,
          })}`
        : '';
    const response = await request(
      `https://api.supabase.com/v1/projects/${project}/${endpoint}${query}`,
      {
        method: path === 'edge-logs' ? 'GET' : options.method || 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(options.body && path !== 'edge-logs' ? { body: JSON.stringify(options.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(`Diagnóstico rechazado (HTTP ${response.status}); respuesta omitida`);
    return response.status === 204 ? null : response.json();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
    assert.equal(process.env.GITHUB_REPOSITORY, 'EduardoCR90/restaurant-platform-dashboard');
    assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
    const requestId = process.env.PROVISIONING_REQUEST_ID?.trim();
    const slug = process.env.PROVISIONING_RESTAURANT_SLUG?.trim();
    assert.notEqual(Boolean(requestId), Boolean(slug));
    const failedAtUtc = process.env.PROVISIONING_FAILED_AT_UTC?.trim();
    const result = await diagnoseProvisioning(
      requestId ? { requestId } : { restaurantSlug: slug },
      managementApi(process.env.SUPABASE_ACCESS_TOKEN),
      failedAtUtc ? { failedAtUtc } : undefined,
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      error instanceof DiagnosticFailure
        ? error.message
        : error?.message?.startsWith('Diagnóstico rechazado (HTTP ')
          ? error.message
          : 'Diagnóstico detenido: no se muestran secretos, filas completas ni respuestas privadas.',
    );
    process.exitCode = 1;
  }
}
