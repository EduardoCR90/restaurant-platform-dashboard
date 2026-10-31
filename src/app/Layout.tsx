import { useRef } from 'react';
import { useUnsavedChanges } from './UnsavedChanges';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../services/platform';
import { useAuth } from '../features/auth/AuthProvider';
import { useRestaurant } from '../features/restaurants/RestaurantProvider';
import { Feedback, Loading } from '../components/Feedback';
export function Layout() {
  const guard = useUnsavedChanges();
  const auth = useAuth();
  const workspace = useRestaurant();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const links = [
    ['/', 'Vista general'],
    ['/content/page', 'Contenido'],
    ['/content/category', 'Carta'],
    ['/modules', 'Módulos'],
    ['/settings', 'Configuración'],
    ['/profile', 'Mi perfil'],
    ...(workspace.data?.admin ? [['/administration', 'Administración']] : []),
  ];
  const nav = (
    <nav aria-label="Navegación del espacio">
      {links.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/'} onClick={() => dialog.current?.close()}>
          {label}
          <span aria-hidden="true">↗</span>
        </NavLink>
      ))}
    </nav>
  );
  async function logout() {
    if (!guard.confirmLeave()) return;
    const { error } = await supabase.auth.signOut();
    if (!error) {
      guard.setDirty(false);
      navigate('/login', { replace: true });
    }
  }
  return (
    <div className="workspace">
      <a href="#main" className="skip">
        Saltar al contenido
      </a>
      <aside className="sidebar">
        <NavLink className="brand" to="/">
          restaurant<span>platform / workspace</span>
        </NavLink>
        <p className="sidebar-label">Tu espacio de gestión</p>
        {nav}
        <div className="sidebar-bottom">
          <span>{auth.profile?.display_name || auth.session?.user.email}</span>
          <button onClick={() => void logout()}>Cerrar sesión ↗</button>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => dialog.current?.showModal()}>
            Menú
          </button>
          <div className="restaurant-switch">
            <label htmlFor="restaurant-switch">Restaurante</label>
            <select
              id="restaurant-switch"
              value={workspace.restaurant?.id || ''}
              onChange={(e) => {
                if (e.target.value === workspace.restaurant?.id) return;
                if (!guard.confirmLeave()) return;
                guard.setDirty(false);
                workspace.select(e.target.value);
                navigate('/');
              }}
              disabled={!workspace.data?.restaurants.length}
            >
              {!workspace.data?.restaurants.length && (
                <option value="">Sin restaurante asignado</option>
              )}
              {workspace.data?.restaurants.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.name}
                  {r.status !== 'active' ? ` · ${r.status}` : ''}
                </option>
              ))}
            </select>
          </div>
          <NavLink to="/profile" className="user-link">
            {auth.profile?.display_name || 'Mi perfil'} <span aria-hidden="true">↗</span>
          </NavLink>
        </header>
        <main id="main" tabIndex={-1}>
          {workspace.loading ? (
            <Loading />
          ) : workspace.error ? (
            <>
              <Feedback error={workspace.error} />
              <button onClick={() => void workspace.reload()}>Volver a intentar</button>
            </>
          ) : (
            <Outlet key={workspace.restaurant?.id || 'none'} />
          )}
        </main>
        <footer className="app-footer">
          Restaurant Platform <span>La gestión, con intención.</span>
        </footer>
      </div>
      <dialog ref={dialog} className="mobile-dialog">
        <button className="close-dialog" onClick={() => dialog.current?.close()}>
          Cerrar menú
        </button>
        {nav}
        <button onClick={() => void logout()}>Cerrar sesión</button>
      </dialog>
    </div>
  );
}
