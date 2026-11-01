import { useEffect, useState } from 'react';
import { useRestaurant } from '../restaurants/RestaurantProvider';
import { adminOperation, loadWebsiteVersions } from '../../services/platform';
import { Feedback } from '../../components/Feedback';
import type { TemplateRelease, WebsiteState } from '../../../shared/platform-contract';
export function WebsiteVersions() {
  const ctx = useRestaurant();
  const restaurantId = ctx.restaurant?.id;
  const [state, setState] = useState<WebsiteState | null>(null);
  const [catalog, setCatalog] = useState<TemplateRelease[]>([]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setState(null);
    setChoice('');
    setError('');
    setMessage('');
    setCatalog([]);
    if (restaurantId)
      void loadWebsiteVersions(restaurantId)
        .then((value) => {
          if (active) {
            setState(value.website);
            setCatalog(value.releases);
          }
        })
        .catch(() => {
          if (active)
            setError('No se pudo consultar la versión. Revisa la configuración de la plataforma.');
        });
    return () => {
      active = false;
    };
  }, [restaurantId, refresh]);
  async function request() {
    const release = catalog.find((item) => item.template_key + '@' + item.version === choice);
    if (!release || !restaurantId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await adminOperation({
        operation: 'select_template',
        payload: {
          restaurant_id: restaurantId,
          template_key: release.template_key,
          version: release.version,
          expected_revision: state?.revision ?? null,
        },
      });
      setRefresh((n) => n + 1);
      setMessage(
        'Versión solicitada. Su instalación requiere la actualización y el despliegue validados; la web actual se conserva.',
      );
    } catch {
      setError(
        'No se pudo seleccionar la versión. Recarga para revisar permisos, compatibilidad y revisión.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="narrow-form" aria-label="Template y versión de la web">
      <h2>Template y versión de la web</h2>
      <p>
        Instalada:{' '}
        {state?.installed_release
          ? `${state.installed_release.template_key} · ${state.installed_release.version}`
          : 'Pendiente de confirmación del despliegue'}
      </p>
      {state?.verified_run_id && <p>Despliegue verificado: {state.verified_run_id}</p>}
      {state?.desired_release && (
        <p>
          Seleccionada: {state.desired_release.template_key} · {state.desired_release.version}
          {state.desired_release.version !== state.installed_release?.version
            ? ' · Pendiente de actualización validada'
            : ''}
        </p>
      )}
      <Feedback error={error} message={message} />
      {ctx.data?.admin && (
        <>
          <label>
            Versión aprobada del template
            <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy}>
              <option value="">Selecciona una versión</option>
              {catalog.map((release) => (
                <option
                  key={release.template_key + '@' + release.version}
                  value={release.template_key + '@' + release.version}
                >
                  {release.template_key} · {release.version}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy || !choice} onClick={() => void request()}>
            Seleccionar actualización validada
          </button>
          <p className="muted">
            Solo Super Admin. Seleccionar no crea una web ni despliega sin controles de integridad,
            compatibilidad y build. El aprovisionamiento automático corresponde a la fase 6.
          </p>
        </>
      )}
    </section>
  );
}
