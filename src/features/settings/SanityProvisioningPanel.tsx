import { useState, type FormEvent } from 'react';
import type { SanityProvisioningJob } from '../../../shared/sanity-provisioning';
import { provisionSanity } from '../../services/platform';
import { Feedback } from '../../components/Feedback';

export function SanityProvisioningPanel() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [job, setJob] = useState<SanityProvisioningJob | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(operation: 'start' | 'retry' | 'status', startRequestId?: string) {
    setBusy(true);
    setError('');
    try {
      let input;
      if (operation === 'start') {
        if (!startRequestId) throw new Error('Falta el identificador estable de la solicitud');
        input = {
          operation,
          payload: { request_id: startRequestId, name, slug, dataset: 'production' as const },
        };
      } else {
        if (!job) throw new Error('Falta la solicitud de aprovisionamiento');
        input = { operation, payload: { request_id: job.request_id } };
      }
      const result = await provisionSanity(input);
      setJob(result);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'No se pudo iniciar el aprovisionamiento',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const stableRequestId = requestId || crypto.randomUUID();
    setRequestId(stableRequestId);
    await run('start', stableRequestId);
  }

  return (
    <section aria-labelledby="sanity-provisioning-title">
      <h2 id="sanity-provisioning-title">Nuevo proyecto Sanity</h2>
      <p>
        Crea el restaurante pendiente, un proyecto dedicado, su dataset production y una credencial
        cifrada. Cliente, template, módulos y dominio se asignarán en las siguientes iteraciones.
      </p>
      <form className="narrow-form" onSubmit={submit}>
        <label>
          Nombre del restaurante
          <input
            required
            maxLength={120}
            value={name}
            disabled={busy || job?.status === 'running'}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Slug interno
          <input
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={slug}
            disabled={busy || job?.status === 'running'}
            onChange={(event) => setSlug(event.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || job?.status === 'running'}>
          {requestId && !job ? 'Reanudar solicitud' : 'Crear base editorial'}
        </button>
      </form>
      {requestId && !job && <p className="muted">Solicitud: {requestId}</p>}
      {job && (
        <div className="status-panel" aria-live="polite">
          <strong>Estado: {job.status}</strong>
          <p>
            Etapa: {job.stage} · intento {job.attempt_count}
          </p>
          <p>
            Proyecto: {job.project_id} · dataset {job.dataset}
          </p>
          <p className="muted">Solicitud: {job.request_id}</p>
          {job.error_code && <p>Categoría del error: {job.error_code}</p>}
          {job.status === 'manual_review' && (
            <p>Revisa el token en Sanity antes de cualquier nueva ejecución.</p>
          )}
          <button type="button" disabled={busy} onClick={() => void run('status')}>
            Actualizar estado
          </button>{' '}
          {job.status === 'failed' && job.retryable && (
            <button type="button" disabled={busy} onClick={() => void run('retry')}>
              Reintentar de forma explícita
            </button>
          )}
        </div>
      )}
      <Feedback error={error} />
    </section>
  );
}
