import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadWorkspace, type Workspace, type Restaurant } from '../../services/platform';
import { useAuth } from '../auth/AuthProvider';
import { canUseContent, type Role } from '../../../shared/access';
type Value = {
  data: Workspace | null;
  restaurant: Restaurant | null;
  select: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
  error: string;
  role: Role | null;
  contentAllowed: boolean;
};
const Context = createContext<Value | null>(null);
export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [data, setData] = useState<Workspace | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function reload() {
    if (!data) setLoading(true);
    setError('');
    try {
      setData(await loadWorkspace());
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'No se pudo cargar el espacio');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setSelected('');
    void loadWorkspace()
      .then((value) => {
        if (!active) return;
        setData(value);
        let saved = '';
        try {
          saved = localStorage.getItem('restaurant-preference') || '';
        } catch {
          /* Preferencia opcional. */
        }
        setSelected(
          value.restaurants.some((r) => r.id === saved) ? saved : value.restaurants[0]?.id || '',
        );
        setError('');
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'No se pudo cargar el espacio');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);
  const restaurant =
    data?.restaurants.find((r) => r.id === selected) || data?.restaurants[0] || null;
  const role =
    data?.memberships.find(
      (m) =>
        m.restaurant_id === restaurant?.id &&
        m.user_id === session?.user.id &&
        m.status === 'active',
    )?.role ?? null;
  const granted =
    data?.entitlements.some(
      (m) =>
        m.restaurant_id === restaurant?.id && m.module_key === 'content_management' && m.granted,
    ) ?? false;
  const enabled =
    data?.modules.some(
      (m) =>
        m.restaurant_id === restaurant?.id && m.module_key === 'content_management' && m.enabled,
    ) ?? false;
  function select(id: string) {
    if (!data?.restaurants.some((r) => r.id === id)) return;
    setSelected(id);
    try {
      localStorage.setItem('restaurant-preference', id);
    } catch {
      /* Nunca es autorización. */
    }
  }
  return (
    <Context.Provider
      value={{
        data,
        restaurant,
        select,
        reload,
        loading,
        error,
        role,
        contentAllowed:
          restaurant?.status === 'active' &&
          canUseContent(role, data?.admin ?? false, granted, enabled),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useRestaurant() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('RestaurantProvider requerido');
  return ctx;
}
