import { PublicationStatus } from '../publications/PublicationStatus';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useRestaurant } from './RestaurantProvider';
import { modules } from '../../../shared/access';
export function HomePage() {
  const { profile } = useAuth();
  const ctx = useRestaurant();
  return (
    <>
      <p className="eyebrow">Tu espacio, en perspectiva</p>
      <h1>{profile?.display_name ? `Hola, ${profile.display_name}.` : 'Cada detalle cuenta.'}</h1>
      <p className="lede">
        {ctx.restaurant
          ? `Bienvenido al espacio de ${ctx.restaurant.name}.`
          : 'Aún no tienes un restaurante asignado. Contacta con el administrador para recibir acceso.'}
      </p>
      {ctx.restaurant && (
        <>
          <section className="overview">
            <div>
              <p className="eyebrow">El restaurante</p>
              <h2>{ctx.restaurant.name}</h2>
              <p>
                <span className="status-dot" />
                {ctx.restaurant.status === 'active'
                  ? 'Activo'
                  : ctx.restaurant.status === 'suspended'
                    ? 'Suspendido'
                    : 'Configuración pendiente'}
              </p>
              <p className="muted">
                Tu rol:{' '}
                {ctx.data?.admin
                  ? 'Administrador de plataforma'
                  : ctx.role === 'restaurant_owner'
                    ? 'Propietario'
                    : ctx.role === 'restaurant_manager'
                      ? 'Responsable'
                      : 'Equipo'}
              </p>
            </div>
            <div>
              <p className="eyebrow">Conexiones</p>
              {ctx.data?.integrations
                .filter((i) => i.restaurant_id === ctx.restaurant?.id)
                .map((i) => (
                  <p key={i.id}>
                    Sanity <span className="badge">Configurada en plataforma</span>
                    <small className="muted">
                      Proyecto {i.external_project_id} · {i.external_dataset}
                    </small>
                  </p>
                ))}
              {!ctx.data?.integrations.some((i) => i.restaurant_id === ctx.restaurant?.id) && (
                <p>Sin integración editorial visible para tu cuenta.</p>
              )}
              <p className="muted">La conectividad se comprueba al abrir el editor.</p>
            </div>
          </section>
          {ctx.contentAllowed && (
            <PublicationStatus key={ctx.restaurant.id} restaurantId={ctx.restaurant.id} />
          )}
          <section className="quick-links">
            <p className="eyebrow">Lo esencial, a mano</p>
            {ctx.contentAllowed ? (
              <>
                <Link to="/content/page">
                  <span>
                    <strong>El contenido de tu web</strong>
                    <small>Páginas, bloques e imágenes</small>
                  </span>
                  ↗
                </Link>
                <Link to="/content/dish">
                  <span>
                    <strong>Una carta al día</strong>
                    <small>Platos, categorías y disponibilidad</small>
                  </span>
                  ↗
                </Link>
              </>
            ) : (
              <p>El acceso editorial requiere un rol autorizado y el módulo contratado y activo.</p>
            )}
            <Link to="/modules">
              <span>
                <strong>Tus módulos</strong>
                <small>
                  {modules
                    .filter((m) =>
                      ctx.data?.entitlements.some(
                        (e) =>
                          e.restaurant_id === ctx.restaurant?.id &&
                          e.module_key === m.key &&
                          e.granted,
                      ),
                    )
                    .map((m) => m.name)
                    .join(' · ') || 'Sin módulos contratados'}
                </small>
              </span>
              ↗
            </Link>
          </section>
          <section className="empty-note">
            <p className="eyebrow">La información que importa</p>
            <h2>Sin cifras inventadas.</h2>
            <p>
              Las reservas y la analítica aparecerán aquí cuando esos módulos estén disponibles y
              tengan datos reales.
            </p>
          </section>
        </>
      )}
    </>
  );
}
