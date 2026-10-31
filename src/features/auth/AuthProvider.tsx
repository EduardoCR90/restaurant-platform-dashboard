import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configurationError, loadProfile, supabase, type Profile } from '../../services/platform';
import { finishEmailLink } from './emailLink';
type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(configurationError);
  async function refresh() {
    if (session) setProfile(await loadProfile(session.user.id));
  }
  useEffect(() => {
    let active = true;
    let sequence = 0;
    async function sync(next: Session | null) {
      const current = ++sequence;
      if (!active) return;
      setLoading(true);
      setSession(next);
      setProfile(null);
      setError(configurationError);
      try {
        if (next) {
          const { error } = await supabase.auth.getUser();
          if (error) throw new Error('Sesión caducada. Vuelve a iniciar sesión.');
          const p = await loadProfile(next.user.id);
          if (active && current === sequence) setProfile(p);
        }
      } catch (e) {
        if (active && current === sequence)
          setError(e instanceof Error ? e.message : 'No se pudo comprobar el acceso');
      } finally {
        if (active && current === sequence) setLoading(false);
      }
    }
    if (configurationError) {
      setLoading(false);
      return;
    }
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      queueMicrotask(() => {
        void sync(next);
      });
    });
    void finishEmailLink()
      .then(() => supabase.auth.getSession())
      .then(({ data, error }) => {
        if (error) {
          if (active) {
            setError('No se pudo recuperar la sesión');
            setLoading(false);
          }
        } else void sync(data.session);
      })
      .catch(() => {
        if (active) {
          setError('Enlace de acceso no válido o caducado. Solicita uno nuevo.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
      sequence++;
      data.subscription.unsubscribe();
    };
  }, []);
  return (
    <Context.Provider value={{ session, profile, loading, error, refresh }}>
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthProvider requerido');
  return value;
}
