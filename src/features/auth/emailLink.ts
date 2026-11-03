import { supabase } from '../../services/platform';

export type EmailLinkType = 'invite' | 'recovery';
export type EmailLinkResult =
  | { status: 'none'; type: null; message: null }
  | { status: 'ready'; type: EmailLinkType; message: null }
  | { status: 'error'; type: EmailLinkType | null; message: string };

let task: Promise<EmailLinkResult> | null = null;

function parameters(url: URL) {
  const values = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  url.searchParams.forEach((value, key) => values.set(key, value));
  return values;
}

function linkType(value: string | null): EmailLinkType | null {
  if (value === 'recovery') return 'recovery';
  if (value === 'invite' || value === 'signup') return 'invite';
  return null;
}

export function hasEmailLinkAttempt(url = new URL(window.location.href)) {
  const params = parameters(url);
  return Boolean(
    params.get('token_hash') ||
    params.get('code') ||
    params.get('access_token') ||
    params.get('error') ||
    params.get('error_code') ||
    params.get('error_description'),
  );
}

export function normalizeEmailLinkRoute() {
  const url = new URL(window.location.href);
  if (!hasEmailLinkAttempt(url) || url.pathname === '/auth/update-password') return;
  url.pathname = '/auth/update-password';
  window.history.replaceState(window.history.state, '', url.toString());
}

function clearSensitiveParameters(url: URL) {
  for (const key of [
    'token_hash',
    'type',
    'code',
    'sb_flow_id',
    'access_token',
    'refresh_token',
    'expires_in',
    'expires_at',
    'token_type',
    'provider_token',
    'provider_refresh_token',
    'error',
    'error_code',
    'error_description',
  ])
    url.searchParams.delete(key);
  url.hash = '';
  window.history.replaceState(window.history.state, '', url.pathname + url.search);
}

async function exchangeEmailLink(): Promise<EmailLinkResult> {
  const url = new URL(window.location.href);
  const params = parameters(url);
  const type = linkType(params.get('type'));
  const attempted = hasEmailLinkAttempt(url);
  if (!attempted) return { status: 'none', type: null, message: null };

  try {
    if (params.get('error') || params.get('error_code') || params.get('error_description'))
      return {
        status: 'error',
        type,
        message: 'El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.',
      };

    const tokenHash = params.get('token_hash');
    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) throw error;
      return { status: 'ready', type, message: null };
    }

    const code = params.get('code');
    if (code) {
      const flowId = params.get('sb_flow_id') || undefined;
      const { data, error } = await supabase.auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      );
      if (error || !data.session) throw error || new Error('Sesión no disponible');
      return {
        status: 'ready',
        // Supabase no expone redirectType en el tipo público. Los códigos de
        // esta ruta proceden de resetPasswordForEmail; las invitaciones usan
        // token_hash o el fragmento implicit porque Admin Invite no admite PKCE.
        type: type || 'recovery',
        message: null,
      };
    }

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken && refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error || !data.session) throw error || new Error('Sesión no disponible');
      return { status: 'ready', type: type || 'recovery', message: null };
    }

    return {
      status: 'error',
      type,
      message: 'El enlace de acceso está incompleto. Solicita uno nuevo.',
    };
  } catch {
    return {
      status: 'error',
      type,
      message: 'El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.',
    };
  } finally {
    clearSensitiveParameters(url);
  }
}

// La promesa única evita canjear dos veces un enlace de un solo uso bajo StrictMode.
export function finishEmailLink(): Promise<EmailLinkResult> {
  if (!task) task = exchangeEmailLink();
  return task;
}
