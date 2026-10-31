// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { documentSchemas } from '../shared/content';
import { fields, contentFields } from '../src/features/content/fields';
import type { Field } from '../src/features/content/fields';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/editorial-contract.json', import.meta.url), 'utf8'),
);
function paths(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? [...paths(v as Record<string, unknown>, prefix + k + '.')]
      : [prefix + k],
  );
}
function formPaths(defs: Field[], prefix = ''): string[] {
  return defs.flatMap((f) =>
    f.type === 'object'
      ? formPaths(f.fields || [], prefix + f.name + '.')
      : f.type === 'link'
        ? [prefix + f.name + '.label', prefix + f.name + '.href']
        : [prefix + f.name],
  );
}
describe('Contrato editorial compartido; sin servicios externos', () => {
  it('acepta todos los campos de la fixture común sin perderlos y cada campo tiene formulario', () => {
    expect(documentSchemas.page.shape.composition.parse(fixture.page.composition)).toEqual(
      fixture.page.composition,
    );
    expect(documentSchemas.settings.shape.editorial.parse(fixture.settings.editorial)).toEqual(
      fixture.settings.editorial,
    );
    for (const path of paths(fixture.page)) expect(formPaths(fields.page)).toContain(path);
    for (const path of paths(fixture.settings)) expect(formPaths(fields.settings)).toContain(path);
    expect(fields.settings.some((f) => f.name === 'socialImage')).toBe(true);
  });
  it('no exige campos nuevos en documentos históricos; admite restauración y ocultación de enlace', () => {
    expect(documentSchemas.page.shape.composition.parse(undefined)).toBeUndefined();
    expect(documentSchemas.settings.shape.editorial.parse({ footer: { link: null } })).toEqual({
      footer: { link: null },
    });
    expect(
      documentSchemas.page.shape.composition.parse({
        essence: { heading: { before: 'Sin cursiva' } },
      }),
    ).toEqual({ essence: { heading: { before: 'Sin cursiva' } } });
  });
  it('rechaza enlaces inseguros y titulares vacíos sin permitir objetos de contenido arbitrario', () => {
    expect(() =>
      documentSchemas.page.shape.composition.parse({
        hero: { link: { label: 'X', href: '//example.test' } },
      }),
    ).toThrow();
    expect(() =>
      documentSchemas.page.shape.composition.parse({ essence: { heading: {} } }),
    ).toThrow();
    expect(
      documentSchemas.settings.shape.editorial.parse({
        signature: 'Nueva marca',
        arbitraryMutation: 'delete',
      }),
    ).toEqual({ signature: 'Nueva marca' });
  });
  it('muestra solo grupos que usa la composición; bloques no convierten ni eliminan sus campos heredados', () => {
    const doc = { slug: { current: 'inicio' }, blocks: [], composition: fixture.page.composition };
    const original = structuredClone(doc);
    expect(
      contentFields('page', doc)
        .find((f) => f.name === 'composition')
        ?.fields?.map((f) => f.name),
    ).toEqual(['hero', 'essence', 'featured', 'storyPreview']);
    expect(
      contentFields('page', { ...doc, blocks: [{ _type: 'hero' }] }).some(
        (f) => f.name === 'composition',
      ),
    ).toBe(false);
    expect(
      contentFields('page', { ...doc, slug: { current: 'eventos' } }).some(
        (f) => f.name === 'composition',
      ),
    ).toBe(false);
    expect(doc).toEqual(original);
  });
});
