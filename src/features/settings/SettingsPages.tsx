import { WebsiteVersions } from './WebsiteVersions';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useRestaurant } from '../restaurants/RestaurantProvider';
import { useAuth } from '../auth/AuthProvider';
import { updateName, updateProfile, supabase, adminOperation } from '../../services/platform';
import { Feedback } from '../../components/Feedback';
import { adminRequest, roles, moduleKeys } from '../../../shared/access';
import { SanityProvisioningPanel } from './SanityProvisioningPanel';
export function SettingsPage() {
  const ctx = useRestaurant();
  const [name, setName] = useState(ctx.restaurant?.name || '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed =
    ctx.restaurant?.status === 'active' &&
    (ctx.data?.admin || ctx.role === 'restaurant_owner' || ctx.role === 'restaurant_manager');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ctx.restaurant) return;
    setBusy(true);
    setError('');
    try {
      await updateName(ctx.restaurant.id, name);
      await ctx.reload();
      setMessage('Nombre actualizado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Los detalles de tu negocio</p>
      <h1>Configuración</h1>
      {ctx.restaurant ? (
        <>
          <p className="lede">
            Datos de la plataforma para {ctx.restaurant.name}. La identidad pública se edita en
            contenido.
          </p>
          <WebsiteVersions key={ctx.restaurant.id} />
          <form className="narrow-form" onSubmit={submit}>
            <label>
              Nombre en plataforma
              <input
                value={name}
                maxLength={120}
                required
                disabled={!allowed || busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <p>
              Identificador: {ctx.restaurant.slug} · Estado: {ctx.restaurant.status}
            </p>
            <Feedback error={error} message={message} />
            <button className="primary" disabled={!allowed || busy}>
              Guardar nombre
            </button>
          </form>
          {ctx.contentAllowed && (
            <Link className="text-link" to="/content/settings/restaurant-settings">
              Editar información pública y horarios ↗
            </Link>
          )}
        </>
      ) : (
        <p>No tienes restaurante asignado.</p>
      )}
    </>
  );
}
export function ProfilePage() {
  const auth = useAuth();
  const [name, setName] = useState(auth.profile?.display_name || '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!auth.session) return;
    setBusy(true);
    setError('');
    try {
      await updateProfile(auth.session.user.id, name);
      await auth.refresh();
      setMessage('Perfil actualizado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Tu cuenta de equipo</p>
      <h1>Mi perfil</h1>
      <form className="narrow-form" onSubmit={save}>
        <label>
          Nombre
          <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email
          <input value={auth.session?.user.email || ''} readOnly type="email" />
        </label>
        <Feedback error={error} message={message} />
        <button className="primary" disabled={busy}>
          Guardar perfil
        </button>
      </form>
      <Link to="/auth/update-password">Cambiar contraseña</Link>
      <button className="logout" onClick={() => void supabase.auth.signOut()}>
        Cerrar sesión
      </button>
    </>
  );
}
type AdminField = { name: string; label: string; options?: readonly string[] };
const adminFields: Record<string, AdminField[]> = {
  module_activation: [
    { name: 'restaurant_id', label: 'UUID del restaurante' },
    { name: 'module_key', label: 'Módulo', options: moduleKeys },
    { name: 'enabled', label: 'Activo', options: ['true', 'false'] },
  ],
  restaurant: [
    { name: 'name', label: 'Nombre' },
    { name: 'slug', label: 'Slug' },
    { name: 'status', label: 'Estado', options: ['pending', 'active', 'suspended'] },
  ],
  membership: [
    { name: 'restaurant_id', label: 'UUID del restaurante' },
    { name: 'user_id', label: 'UUID del usuario' },
    { name: 'role', label: 'Rol', options: roles },
    { name: 'status', label: 'Estado', options: ['active', 'invited', 'suspended'] },
  ],
  entitlement: [
    { name: 'restaurant_id', label: 'UUID del restaurante' },
    { name: 'module_key', label: 'Módulo', options: moduleKeys },
    { name: 'granted', label: 'Contratado', options: ['true', 'false'] },
  ],
  integration: [
    { name: 'restaurant_id', label: 'UUID del restaurante' },
    { name: 'project_id', label: 'Sanity Project ID' },
    { name: 'dataset', label: 'Sanity Dataset' },
  ],
  restaurant_status: [
    { name: 'restaurant_id', label: 'UUID del restaurante' },
    { name: 'status', label: 'Estado', options: ['pending', 'active', 'suspended'] },
  ],
  user_status: [
    { name: 'user_id', label: 'UUID del usuario' },
    { name: 'status', label: 'Estado', options: ['active', 'suspended'] },
  ],
  invite: [
    { name: 'restaurant_id', label: 'UUID del restaurante' },
    { name: 'email', label: 'Email real del invitado' },
    { name: 'role', label: 'Rol', options: roles },
  ],
};
export function AdminPage() {
  const ctx = useRestaurant();
  const [operation, setOperation] = useState('restaurant');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ctx.data?.admin) return <p role="alert">Requiere Super Admin.</p>;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const payload = {
        ...values,
        ...(operation === 'entitlement' ? { granted: values.granted === 'true' } : {}),
        ...(operation === 'module_activation' ? { enabled: values.enabled === 'true' } : {}),
      };
      const input = adminRequest.parse({ operation, payload });
      await adminOperation(input);
      await ctx.reload();
      setMessage('Operación completada y registrada.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Super Admin · Administración de plataforma</p>
      <h1>Una base común.</h1>
      <p className="lede">
        Operaciones privilegiadas. Los restaurantes no pueden concederse módulos o privilegios
        globales.
      </p>
      <div className="content-list">
        {ctx.data.restaurants.map((r) => (
          <div key={r.id}>
            <strong>{r.name}</strong>
            <small>
              {r.id} · {r.status}
            </small>
          </div>
        ))}
      </div>
      <SanityProvisioningPanel />
      <form className="narrow-form" onSubmit={submit}>
        <label>
          Operación
          <select
            value={operation}
            onChange={(e) => {
              setOperation(e.target.value);
              setValues({});
            }}
          >
            {Object.keys(adminFields).map((key) => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
        {adminFields[operation].map((field) => (
          <label key={field.name}>
            {field.label}
            {field.options ? (
              <select
                required
                value={values[field.name] || ''}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              >
                <option value="">Selecciona</option>
                {field.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                required
                value={values[field.name] || ''}
                onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              />
            )}
          </label>
        ))}
        <Feedback error={error} message={message} />
        <button className="primary" disabled={busy}>
          Ejecutar operación privilegiada
        </button>
      </form>
    </>
  );
}
