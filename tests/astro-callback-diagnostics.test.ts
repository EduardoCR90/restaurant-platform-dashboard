import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { HttpError } from '../shared/editor-service';
import {
  astroCallbackDiagnostic,
  logAstroCallbackFailure,
} from '../supabase/functions/_shared/astro-callback-diagnostics';
import { AstroProvisioningDatabaseError } from '../supabase/functions/_shared/astro-provisioning-service';
import { GithubManagementError } from '../supabase/functions/_shared/github-management';

describe('Astro callback diagnostics', () => {
  it.each([
    [new AstroProvisioningDatabaseError(), 'database', 503],
    [new GithubManagementError('manifest', false, true), 'manifest', 503],
    [new GithubManagementError('permissions', false), 'permissions', 403],
    [new HttpError(401, 'private identity detail'), 'identity', 401],
    [new ZodError([]), 'contract', 422],
    [new Error('private provider response'), 'provider_response', 500],
  ])('maps errors to a closed safe category', (error, category, status) => {
    expect(astroCallbackDiagnostic('source_verification', error)).toEqual({
      phase: 'source_verification',
      category,
      status,
    });
  });

  it('logs only request correlation, phase and category', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logAstroCallbackFailure('7c0d6fd5-9534-4579-9062-96d3dc76eb08', {
      phase: 'state_confirmation',
      category: 'database',
      status: 503,
    });
    expect(output).toHaveBeenCalledOnce();
    const line = String(output.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({
      event: 'astro-provisioning.source-ready-failed',
      component: 'astro-provisioning',
      request_id: '7c0d6fd5-9534-4579-9062-96d3dc76eb08',
      phase: 'state_confirmation',
      category: 'database',
    });
    expect(line).not.toContain('private');
    output.mockRestore();
  });
});
