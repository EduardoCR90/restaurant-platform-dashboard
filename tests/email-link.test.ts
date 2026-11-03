import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
};

vi.mock('../src/services/platform', () => ({ supabase: { auth } }));

async function loadLink(url: string) {
  vi.resetModules();
  history.replaceState(null, '', url);
  return import('../src/features/auth/emailLink');
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
  auth.setSession.mockResolvedValue({ data: { session: {} }, error: null });
});

describe('callbacks de recuperación e invitación', () => {
  it('canjea una invitación token_hash una sola vez y elimina el secreto de la URL', async () => {
    const { finishEmailLink } = await loadLink(
      '/auth/update-password?token_hash=one-use-test-token&type=invite',
    );
    const [first, second] = await Promise.all([finishEmailLink(), finishEmailLink()]);
    expect(first).toEqual({ status: 'ready', type: 'invite', message: null });
    expect(second).toEqual(first);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'one-use-test-token',
      type: 'invite',
    });
    expect(window.location.href).not.toContain('one-use-test-token');
  });

  it('acepta una recuperación implicit en una sesión de navegador limpia', async () => {
    const { finishEmailLink } = await loadLink(
      '/auth/update-password#access_token=test-access&refresh_token=test-refresh&type=recovery&expires_in=3600&token_type=bearer',
    );
    await expect(finishEmailLink()).resolves.toEqual({
      status: 'ready',
      type: 'recovery',
      message: null,
    });
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
    });
    expect(window.location.hash).toBe('');
  });

  it('conserva compatibilidad con callbacks PKCE iniciados en el mismo navegador', async () => {
    const { finishEmailLink } = await loadLink(
      '/auth/update-password?code=auth-code&sb_flow_id=12345678-1234-4234-8234-123456789012',
    );
    await expect(finishEmailLink()).resolves.toMatchObject({
      status: 'ready',
      type: 'recovery',
    });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('auth-code', {
      flowId: '12345678-1234-4234-8234-123456789012',
    });
    expect(window.location.search).toBe('');
  });

  it('clasifica enlaces caducados sin exponer la respuesta privada ni usar una sesión previa', async () => {
    const { finishEmailLink } = await loadLink(
      '/auth/update-password?error=access_denied&error_code=otp_expired&error_description=private&type=recovery',
    );
    await expect(finishEmailLink()).resolves.toEqual({
      status: 'error',
      type: 'recovery',
      message: 'El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.',
    });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('normaliza callbacks que Supabase envía a la Site URL', async () => {
    const { normalizeEmailLinkRoute } = await loadLink(
      '/#access_token=test-access&refresh_token=test-refresh&type=invite',
    );
    normalizeEmailLinkRoute();
    expect(window.location.pathname).toBe('/auth/update-password');
    expect(window.location.hash).toContain('type=invite');
  });
});
