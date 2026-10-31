import { supabase } from '../../services/platform';
let task: Promise<void> | null = null;
// Las plantillas token_hash permiten aceptar invitaciones en otro dispositivo.
// La promesa única evita canjear dos veces bajo StrictMode.
export function finishEmailLink(): Promise<void> {
  if (task) return task;
  const url = new URL(window.location.href);
  const hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (!hash || (type !== 'invite' && type !== 'recovery')) return Promise.resolve();
  url.searchParams.delete('token_hash');
  url.searchParams.delete('type');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  task = supabase.auth.verifyOtp({ token_hash: hash, type }).then(({ error }) => {
    if (error) throw new Error('El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.');
  });
  return task;
}
