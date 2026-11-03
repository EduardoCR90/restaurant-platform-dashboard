import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Feedback, Loading } from '../../components/Feedback';
import { loadTemplateCatalog, provisionRestaurant, type ApiError } from '../../services/platform';
import {
  restaurantProvisioningRequest,
  type RestaurantProvisioningJob,
} from '../../../shared/restaurant-provisioning';
import { moduleNames, type TemplateRelease } from '../../../shared/platform-contract';
import { modules as moduleCatalog } from '../../../shared/access';
import { presetNames } from '../../../shared/visual';
import { useRestaurant } from '../restaurants/RestaurantProvider';

const stageLabels = {
  sanity: 'Base editorial Sanity',
  astro: 'Repositorio, build y GitHub Pages',
  client_invitation: 'Invitación y permisos del cliente',
  completed: 'Alta completada',
} as const;
const statusLabels = {
  running: 'En curso',
  awaiting: 'Esperando una operación externa',
  succeeded: 'Completado',
  failed: 'Interrumpido',
  manual_review: 'Revisión manual necesaria',
} as const;

export function RestaurantProvisioningPanel() {
  const workspace = useRestaurant();
  const [releases, setReleases] = useState<TemplateRelease[]>([]);
  const [jobs, setJobs] = useState<RestaurantProvisioningJob[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'restaurant_owner' | 'restaurant_manager'>('restaurant_owner');
  const [release, setRelease] = useState('');
  const [preset, setPreset] = useState<(typeof presetNames)[number]>('elegant');
  const [enabledModules, setEnabledModules] = useState<string[]>(['content_management']);
  const [domain, setDomain] = useState('');
  const [domainMode, setDomainMode] = useState<'apex' | 'subdomain'>('subdomain');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const current = useMemo(
    () => jobs.find((job) => job.request_id === selected) || null,
    [jobs, selected],
  );

  const replaceJob = useCallback((job: RestaurantProvisioningJob) => {
    setJobs((items) => [job, ...items.filter((item) => item.request_id !== job.request_id)]);
    setSelected(job.request_id);
  }, []);

  const refreshList = useCallback(async () => {
    const result = await provisionRestaurant({ operation: 'list', payload: { limit: 20 } });
    if (!Array.isArray(result)) throw new Error('Respuesta de altas inválida');
    setJobs(result);
    setSelected((value) => value || result[0]?.request_id || null);
  }, []);

  useEffect(() => {
    void Promise.all([loadTemplateCatalog(), refreshList()])
      .then(([catalog]) => {
        setReleases(catalog);
        setRelease((value) => value || `${catalog[0]?.template_key}@${catalog[0]?.version}`);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'No se pudo cargar el aprovisionador'),
      )
      .finally(() => setLoading(false));
  }, [refreshList]);

  const run = useCallback(
    async (operation: 'status' | 'retry' | 'verify_sanity_admin', requestId: string) => {
      setBusy(true);
      setError('');
      try {
        const result = await provisionRestaurant({ operation, payload: { request_id: requestId } });
        if (Array.isArray(result)) throw new Error('Respuesta de alta inválida');
        replaceJob(result);
        if (result.status === 'succeeded') await workspace.reload();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'No se pudo actualizar el estado del alta',
        );
      } finally {
        setBusy(false);
      }
    },
    [replaceJob, workspace],
  );

  useEffect(() => {
    if (
      !current ||
      !['running', 'awaiting'].includes(current.status) ||
      current.sanity?.stage === 'awaiting_sanity_admin' ||
      busy
    )
      return;
    const timer = window.setTimeout(() => void run('status', current.request_id), 8_000);
    return () => window.clearTimeout(timer);
  }, [busy, current, run]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const [template_key, version] = release.split('@');
      const request = restaurantProvisioningRequest.parse({
        operation: 'start',
        payload: {
          request_id: crypto.randomUUID(),
          name,
          slug,
          client_email: email,
          client_role: role,
          template: { template_key, version },
          visual: { preset },
          modules: moduleNames.map((key) => ({
            key,
            granted: enabledModules.includes(key),
            enabled: enabledModules.includes(key),
          })),
          ...(domain ? { domain: { hostname: domain.toLowerCase(), mode: domainMode } } : {}),
        },
      });
      const result = await provisionRestaurant(request);
      if (Array.isArray(result)) throw new Error('Respuesta de alta inválida');
      replaceJob(result);
    } catch (caught) {
      const api = caught as ApiError;
      setError(api instanceof Error ? api.message : 'No se pudo iniciar el alta');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  return (
    <section className="provisioning" aria-labelledby="restaurant-provisioning-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Alta integral · Solo Super Admin</p>
          <h2 id="restaurant-provisioning-title">Crear un restaurante</h2>
        </div>
        <p>
          Una solicitud coordina Sanity, la web Astro, GitHub Pages y el acceso editorial del
          cliente. Los identificadores externos se resuelven en el servidor.
        </p>
      </div>
      <form className="provisioning-form" onSubmit={submit}>
        <fieldset>
          <legend>Restaurante y cliente</legend>
          <label>
            Nombre
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Slug interno
            <input
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </label>
          <label>
            Email del cliente
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Permiso editorial
            <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
              <option value="restaurant_owner">Propietario</option>
              <option value="restaurant_manager">Manager</option>
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Web y diseño</legend>
          <label>
            Template versionado
            <select required value={release} onChange={(event) => setRelease(event.target.value)}>
              {releases.map((item) => (
                <option
                  key={`${item.template_key}@${item.version}`}
                  value={`${item.template_key}@${item.version}`}
                >
                  {item.template_key} · v{item.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dirección visual
            <select
              value={preset}
              onChange={(event) => setPreset(event.target.value as typeof preset)}
            >
              <option value="elegant">Elegant</option>
              <option value="modern">Modern</option>
              <option value="casual">Casual</option>
            </select>
          </label>
          <div className="field-group">
            <span>Módulos</span>
            {moduleCatalog.map((module) => (
              <label className="check-row" key={module.key}>
                <input
                  type="checkbox"
                  checked={enabledModules.includes(module.key)}
                  disabled={module.key === 'content_management'}
                  onChange={(event) =>
                    setEnabledModules((items) =>
                      event.target.checked
                        ? [...items, module.key]
                        : items.filter((key) => key !== module.key),
                    )
                  }
                />
                {module.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Dominio opcional</legend>
          <label>
            Dominio solicitado
            <input
              value={domain}
              placeholder="www.ejemplo.com"
              onChange={(event) => setDomain(event.target.value)}
            />
          </label>
          <label>
            Tipo de registro
            <select
              value={domainMode}
              disabled={!domain}
              onChange={(event) => setDomainMode(event.target.value as typeof domainMode)}
            >
              <option value="subdomain">Subdominio / www</option>
              <option value="apex">Dominio raíz</option>
            </select>
          </label>
          <p className="muted">
            Se mostrarán instrucciones DNS; la plataforma no toca el registrador.
          </p>
        </fieldset>
        <button className="primary" disabled={busy || !releases.length}>
          Preparar restaurante completo
        </button>
      </form>
      <Feedback error={error} />

      {jobs.length > 0 && (
        <div className="provisioning-tracker">
          <div className="provisioning-jobs" aria-label="Altas recientes">
            {jobs.map((job) => (
              <button
                type="button"
                className={job.request_id === selected ? 'active' : ''}
                key={job.request_id}
                onClick={() => setSelected(job.request_id)}
              >
                <strong>{job.name}</strong>
                <span>{statusLabels[job.status]}</span>
              </button>
            ))}
          </div>
          {current && (
            <article className="status-panel" aria-live="polite">
              <p className="eyebrow">{statusLabels[current.status]}</p>
              <h3>{current.name}</h3>
              <p>
                {stageLabels[current.stage]} · intento {current.attempt_count}
              </p>
              <ol className="stage-list">
                {(Object.keys(stageLabels) as (keyof typeof stageLabels)[]).map((stage) => (
                  <li key={stage} className={stage === current.stage ? 'current' : ''}>
                    {stageLabels[stage]}
                  </li>
                ))}
              </ol>
              {current.error_code && <p>Categoría segura: {current.error_code}</p>}
              {current.sanity?.stage === 'awaiting_sanity_admin' && current.sanity.project_id && (
                <div className="manual-checkpoint" role="status">
                  <p className="eyebrow">Acción manual pendiente</p>
                  <h4>Asignar administrador en Sanity</h4>
                  <p>
                    El proyecto de Sanity se ha creado correctamente. Accede a Sanity y asigna tu
                    usuario con el rol Administrator. Cuando hayas terminado, pulsa Verificar y
                    continuar.
                  </p>
                  <dl>
                    <div>
                      <dt>Proyecto</dt>
                      <dd>{current.sanity.name}</dd>
                    </div>
                    <div>
                      <dt>Project ID</dt>
                      <dd>{current.sanity.project_id}</dd>
                    </div>
                  </dl>
                  {current.sanity.manage_url && (
                    <a href={current.sanity.manage_url} target="_blank" rel="noreferrer">
                      Abrir proyecto en Sanity Manage
                    </a>
                  )}
                </div>
              )}
              {current.site_url && (
                <p>
                  URL provisional:{' '}
                  <a href={current.site_url} target="_blank" rel="noreferrer">
                    {current.site_url}
                  </a>
                </p>
              )}
              {current.repository && <p>Repositorio: {current.repository}</p>}
              {current.dns && (
                <div className="dns-instructions">
                  <h4>Registros DNS pendientes</h4>
                  <p>
                    Configura estos registros en tu registrador. No cambies todavía la URL pública
                    hasta verificar la propagación.
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Tipo</th>
                          <th>Nombre</th>
                          <th>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {current.dns.records.map((record) => (
                          <tr key={`${record.type}-${record.name}-${record.value}`}>
                            <td>{record.type}</td>
                            <td>{record.name}</td>
                            <td>{record.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="button-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run('status', current.request_id)}
                >
                  Actualizar estado
                </button>
                {current.status === 'failed' && current.retryable && (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => void run('retry', current.request_id)}
                  >
                    Reintentar etapa segura
                  </button>
                )}
                {current.status === 'awaiting' &&
                  current.stage === 'sanity' &&
                  current.sanity?.stage === 'awaiting_sanity_admin' && (
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => void run('verify_sanity_admin', current.request_id)}
                    >
                      Verificar y continuar
                    </button>
                  )}
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
