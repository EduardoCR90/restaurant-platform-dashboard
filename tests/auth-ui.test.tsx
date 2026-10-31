import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { AuthPage } from '../src/features/auth/AuthPages';
import { Protected } from '../src/app/router';
import { useAuth } from '../src/features/auth/AuthProvider';
import { supabase } from '../src/services/platform';
import { BlockEditor } from '../src/features/content/BlockEditor';
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../src/features/restaurants/RestaurantProvider', () => ({
  useRestaurant: () => ({ restaurant: null, data: null }),
  RestaurantProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../src/services/platform', () => ({
  configurationError: null,
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
  },
  contentApi: { list: vi.fn() },
  loadWorkspace: vi.fn(),
}));
const session = { user: { id: 'u', email: 'owner@example.test' } } as unknown as Session;
const state = {
  session: null,
  profile: null,
  loading: false,
  error: null,
  refresh: vi.fn(),
} satisfies ReturnType<typeof useAuth>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ ...state });
  vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
    data: { user: session.user, session },
    error: null,
  });
  vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
});
function renderPage(mode: 'login' | 'reset' | 'update' = 'login') {
  return render(
    <MemoryRouter>
      <AuthPage mode={mode} />
    </MemoryRouter>,
  );
}
describe('Auth real en servicios; interfaz con mocks', () => {
  it('login valida y llama a Supabase, permite mostrar contraseña', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'owner@example.test');
    await user.type(screen.getByLabelText('Contraseña'), 'valid-password');
    await user.click(screen.getByRole('button', { name: 'Mostrar' }));
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Entrar en mi espacio' }));
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@example.test',
      password: 'valid-password',
    });
  });
  it('errores de credenciales no generan sesión simulada', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'invalid' } as never,
    });
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'owner@example.test');
    await user.type(screen.getByLabelText('Contraseña'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Entrar en mi espacio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo iniciar sesión');
  });
  it('solicita recuperación con destino autorizado del mismo origen', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({ data: {}, error: null });
    renderPage('reset');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'owner@example.test');
    await user.click(screen.getByRole('button', { name: 'Enviar instrucciones' }));
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('owner@example.test', {
      redirectTo: new URL('/auth/update-password', window.location.origin).href,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Si la cuenta existe');
  });
  it('cambio de contraseña requiere sesión y confirmación válida', async () => {
    vi.mocked(useAuth).mockReturnValue({ ...state, session });
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: { user: session.user },
      error: null,
    });
    renderPage('update');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Contraseña'), 'password-long-enough');
    await user.type(screen.getByLabelText('Repite la contraseña'), 'password-long-enough');
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'password-long-enough' });
  });
  it('ruta privada redirige sin sesión o al caducar', () => {
    render(
      <MemoryRouter initialEntries={['/private']}>
        <Routes>
          <Route path="/private" element={<Protected />}>
            <Route index element={<p>Privado</p>} />
          </Route>
          <Route path="/login" element={<p>Login requerido</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Login requerido')).toBeInTheDocument();
    expect(screen.queryByText('Privado')).not.toBeInTheDocument();
  });
  it('perfil suspendido no llega al dashboard y permite logout', async () => {
    vi.mocked(useAuth).mockReturnValue({ ...state, session, error: 'Acceso suspendido' });
    render(
      <MemoryRouter>
        <Protected />
      </MemoryRouter>,
    );
    expect(screen.getByText('Acceso suspendido')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
  it('ordena bloques manteniendo claves; formularios compatibles', async () => {
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <BlockEditor
          value={[
            { _type: 'hero', _key: 'a', title: 'A' },
            { _type: 'divider', _key: 'b' },
          ]}
          options={{ category: [], dish: [] }}
          onChange={onChange}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bajar bloque 1' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        { _type: 'divider', _key: 'b' },
        { _type: 'hero', _key: 'a', title: 'A' },
      ]),
    );
  });
});
