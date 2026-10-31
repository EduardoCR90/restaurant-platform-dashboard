import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RestaurantProvider, useRestaurant } from '../src/features/restaurants/RestaurantProvider';
import { loadWorkspace } from '../src/services/platform';
import { canUseContent } from '../shared/access';
vi.mock('../src/services/platform', () => ({ loadWorkspace: vi.fn() }));
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'user' } } }),
}));
function Viewer() {
  const ctx = useRestaurant();
  if (ctx.loading) return <p>Cargando</p>;
  return (
    <>
      <p>{ctx.restaurant?.name || 'Sin restaurante'}</p>
      <button onClick={() => ctx.select('b')}>Elegir B</button>
      <button onClick={() => ctx.select('outsider')}>Elegir no autorizado</button>
      <p>{ctx.contentAllowed ? 'Editor disponible' : 'Editor no disponible'}</p>
    </>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadWorkspace).mockResolvedValue({
    restaurants: [
      { id: 'a', name: 'A', slug: 'a', status: 'active' },
      { id: 'b', name: 'B', slug: 'b', status: 'active' },
    ],
    memberships: [
      { restaurant_id: 'a', user_id: 'user', role: 'restaurant_owner', status: 'active' },
    ],
    modules: [{ restaurant_id: 'a', module_key: 'content_management', enabled: true }],
    entitlements: [{ restaurant_id: 'a', module_key: 'content_management', granted: true }],
    integrations: [],
    admin: false,
  });
});
describe('Contexto y autorización visual (RLS se prueba aparte)', () => {
  it('solo selecciona restaurantes retornados por RLS e ignora preferencias manipuladas', async () => {
    localStorage.setItem('restaurant-preference', 'outsider');
    render(
      <RestaurantProvider>
        <Viewer />
      </RestaurantProvider>,
    );
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(screen.getByText('Editor disponible')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Elegir no autorizado'));
    expect(screen.getByText('A')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Elegir B'));
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Editor no disponible')).toBeInTheDocument();
  });
  it('no inventa restaurante si no hay membresías', async () => {
    vi.mocked(loadWorkspace).mockResolvedValue({
      restaurants: [],
      memberships: [],
      modules: [],
      entitlements: [],
      integrations: [],
      admin: false,
    });
    render(
      <RestaurantProvider>
        <Viewer />
      </RestaurantProvider>,
    );
    await waitFor(() => expect(screen.getByText('Sin restaurante')).toBeInTheDocument());
  });
  it('requiere rol, contratación y activación, incluso al entrar por ruta directa', () => {
    expect(canUseContent('restaurant_owner', false, true, true)).toBe(true);
    expect(canUseContent('restaurant_staff', false, true, true)).toBe(false);
    expect(canUseContent('restaurant_owner', false, false, true)).toBe(false);
    expect(canUseContent('restaurant_manager', false, true, false)).toBe(false);
  });
});
