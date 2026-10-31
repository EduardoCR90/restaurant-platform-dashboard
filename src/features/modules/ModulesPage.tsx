import { useState } from 'react';
import { modules } from '../../../shared/access';
import { useRestaurant } from '../restaurants/RestaurantProvider';
import { toggleModule } from '../../services/platform';
import { Feedback } from '../../components/Feedback';
export function ModulesPage() {
  const ctx = useRestaurant();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  if (!ctx.restaurant) return <p>No hay restaurante asignado. Solicita acceso al administrador.</p>;
  async function toggle(key: string, enabled: boolean) {
    setBusy(key);
    setError('');
    try {
      await toggleModule(ctx.restaurant!.id, key, enabled);
      await ctx.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar');
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <p className="eyebrow">Un espacio que crece contigo</p>
      <h1>Módulos</h1>
      <p className="lede">Lo que necesitas hoy. Lo que puedes incorporar mañana.</p>
      <Feedback error={error} />
      <div className="module-list">
        {modules.map((module, index) => {
          const granted = ctx.data?.entitlements.some(
            (m) =>
              m.restaurant_id === ctx.restaurant?.id && m.module_key === module.key && m.granted,
          );
          const enabled = ctx.data?.modules.some(
            (m) =>
              m.restaurant_id === ctx.restaurant?.id && m.module_key === module.key && m.enabled,
          );
          return (
            <article key={module.key}>
              <span className="row-number">0{index + 1}</span>
              <div>
                <h2>{module.name}</h2>
                <p>{module.description}</p>
              </div>
              <div>
                <span className="badge">
                  {!module.implemented
                    ? 'Próximamente'
                    : !granted
                      ? 'No contratado'
                      : enabled
                        ? 'Activo'
                        : 'Desactivado'}
                </span>
                {module.implemented &&
                  granted &&
                  ctx.restaurant?.status === 'active' &&
                  (ctx.data?.admin ||
                    ctx.role === 'restaurant_owner' ||
                    ctx.role === 'restaurant_manager') && (
                    <button
                      disabled={busy === module.key}
                      onClick={() => void toggle(module.key, !enabled)}
                    >
                      {enabled ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="muted">
        La contratación la gestiona la plataforma. Activar un módulo no concede permisos de usuario.
      </p>
    </>
  );
}
