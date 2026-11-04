// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { logAstroRepositoryValidation } from '../supabase/functions/_shared/astro-provisioning-diagnostics';

describe('diagnóstico seguro del repositorio Astro', () => {
  it('registra categorías cerradas sin metadatos privados', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logAstroRepositoryValidation({
      event: 'astro-provisioning.repository-validation',
      component: 'astro-provisioning',
      request_id: '7c0d6fd5-9534-4579-9062-96d3dc76eb08',
      source: 'existing',
      outcome: 'rejected',
      issues: ['visibility', 'template_provenance'],
      provenance: 'missing',
    });
    const serialized = String(error.mock.calls[0][0]);
    expect(serialized).toContain('template_provenance');
    expect(serialized).not.toContain('github-backend-secret-value');
    expect(serialized).not.toContain('EduardoCR90/abretucorazon-restaurant');
    error.mockRestore();
  });
});
