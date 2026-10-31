import { it, expect, vi } from 'vitest';
vi.mock('../src/services/platform', () => ({
  supabase: { auth: { verifyOtp: vi.fn(async () => ({ error: null })) } },
}));
it('canjea invitación una sola vez y elimina el token de la URL', async () => {
  const { supabase } = await import('../src/services/platform');
  const { finishEmailLink } = await import('../src/features/auth/emailLink');
  history.replaceState(null, '', '/auth/update-password?token_hash=one-use-test-token&type=invite');
  await Promise.all([finishEmailLink(), finishEmailLink()]);
  expect(supabase.auth.verifyOtp).toHaveBeenCalledTimes(1);
  expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
    token_hash: 'one-use-test-token',
    type: 'invite',
  });
  expect(window.location.search).toBe('');
});
