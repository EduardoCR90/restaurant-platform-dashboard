// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const directory = new URL('../ops/abre-tu-corazon-recovery/', import.meta.url);

describe('procedimiento controlado de Abre Tu Corazón', () => {
  it('mantiene el inventario en solo lectura y fija todas las identidades conocidas', async () => {
    const sql = await readFile(new URL('inspect.sql', directory), 'utf8');
    expect(sql).toContain('6fa2ef1e-5427-4e04-9876-d0413843b1ea');
    expect(sql).toContain('00ba7e95-9bd0-4df4-bd53-f76855c5e91f');
    expect(sql).toContain('307ff26b-57a9-498c-9ee2-b798c2f5c290');
    expect(sql).toContain('hfa8zkyw');
    expect(sql).not.toMatch(/\b(update|delete|insert|truncate|drop)\b/i);
  });

  it('reconcilia únicamente el proyecto real revisado y exige una confirmación de sesión', async () => {
    const sql = await readFile(new URL('reconcile-existing-project.sql', directory), 'utf8');
    expect(sql).toContain("current_setting('app.abre_tu_corazon_confirmation',true)");
    expect(sql).toContain("external_project_id='lvtvr3ef'");
    expect(sql).toContain("project_id<>'ra138101d442db33'");
    expect(sql).toContain("stage='awaiting_sanity_admin'");
    expect(sql).not.toMatch(/delete\s+from/i);
    expect(sql).not.toMatch(/hfa8zkyw[^\n]*(update|delete)/i);
  });

  it('el reset destructivo se niega con dependencias y nunca borra recursos externos', async () => {
    const sql = await readFile(new URL('reset-database-only.sql', directory), 'utf8');
    expect(sql).toContain('DELETE-6fa2ef1e-ABRE-ONLY');
    for (const dependency of [
      'restaurant_integrations',
      'astro_provisioning_jobs',
      'restaurant_websites',
      'website_deployments',
      'restaurant_memberships',
    ])
      expect(sql).toContain(dependency);
    expect(sql).not.toMatch(/api\.sanity|fetch\(|curl|delete\s+project/i);
    expect(sql).toContain("external_project_id='hfa8zkyw'");
  });
});
