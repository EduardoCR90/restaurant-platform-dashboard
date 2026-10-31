import {
  createBrowserRouter,
  createRoutesFromElements,
  RouterProvider,
  Route,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from 'react-router-dom';
import { UnsavedChangesProvider } from './UnsavedChanges';
import { useEffect, useState, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from '../features/auth/AuthProvider';
import { AuthPage } from '../features/auth/AuthPages';
import { RestaurantProvider } from '../features/restaurants/RestaurantProvider';
import { Layout } from './Layout';
import { HomePage } from '../features/restaurants/HomePage';
import { ModulesPage } from '../features/modules/ModulesPage';
const ContentList = lazy(() =>
  import('../features/content/ContentPages').then((m) => ({ default: m.ContentList })),
);
const ContentEditor = lazy(() =>
  import('../features/content/ContentPages').then((m) => ({ default: m.ContentEditor })),
);
import { SettingsPage, ProfilePage, AdminPage } from '../features/settings/SettingsPages';
import { Feedback, Loading } from '../components/Feedback';
import { supabase } from '../services/platform';
export function Protected() {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  if (!auth.session) return <Navigate to="/login" replace />;
  if (!auth.profile)
    return (
      <main className="access-error">
        <h1>Acceso no disponible</h1>
        <Feedback error={auth.error || 'El perfil no tiene acceso activo.'} />
        <button onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>
      </main>
    );
  return <Outlet />;
}
function Workspace() {
  return (
    <RestaurantProvider>
      <Layout />
    </RestaurantProvider>
  );
}
function RouteFocus() {
  const location = useLocation();
  useEffect(() => {
    document.title = 'Restaurant Platform · Espacio privado';
    document.querySelector<HTMLElement>('#main')?.focus();
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return null;
}
function RootFrame() {
  return (
    <AuthProvider>
      <UnsavedChangesProvider>
        <RouteFocus />
        <Outlet />
      </UnsavedChangesProvider>
    </AuthProvider>
  );
}
function EditorRoute() {
  const { kind, id } = useParams();
  return <ContentEditor key={`${kind}/${id}`} />;
}
function ListRoute() {
  const { kind } = useParams();
  return <ContentList key={kind} />;
}
function appRoutes() {
  return createRoutesFromElements(
    <Route element={<RootFrame />}>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/auth/reset-password" element={<AuthPage mode="reset" />} />
      <Route path="/auth/update-password" element={<AuthPage mode="update" />} />
      <Route element={<Protected />}>
        <Route element={<Workspace />}>
          <Route index element={<HomePage />} />
          <Route
            path="content/:kind"
            element={
              <Suspense fallback={<Loading />}>
                <ListRoute />
              </Suspense>
            }
          />
          <Route
            path="content/:kind/:id"
            element={
              <Suspense fallback={<Loading />}>
                <EditorRoute />
              </Suspense>
            }
          />
          <Route path="modules" element={<ModulesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="administration" element={<AdminPage />} />
          <Route
            path="*"
            element={
              <section>
                <h1>No encontramos esa página.</h1>
                <a href="/">Volver al espacio</a>
              </section>
            }
          />
        </Route>
      </Route>
    </Route>,
  );
}
export function App() {
  const [router] = useState(() => createBrowserRouter(appRoutes()));
  return <RouterProvider router={router} />;
}
