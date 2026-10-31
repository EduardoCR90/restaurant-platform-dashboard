import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { FormFields } from '../src/features/content/Fields';
import { editorialField } from '../src/features/content/editorial-fields';
import type { JsonRecord } from '../shared/content';

it('formularios permiten editar, ocultar y restaurar sin convertir páginas ni materializar defaults', async () => {
  function Editor() {
    const [value, setValue] = useState<JsonRecord>({
      editorial: {
        footer: { line: 'Firma personalizada', link: { label: 'Ver carta', href: '/carta/' } },
      },
    });
    return (
      <>
        <FormFields
          definitions={[
            {
              ...editorialField,
              fields: editorialField.fields?.filter((f) => f.name === 'footer'),
            },
          ]}
          value={value}
          onChange={setValue}
          options={{ category: [], dish: [] }}
        />
        <output data-testid="state">{JSON.stringify(value)}</output>
      </>
    );
  }
  render(<Editor />);
  const field = screen.getByRole('textbox', { name: 'Firma del pie' });
  await userEvent.clear(field);
  await userEvent.type(field, 'Otra firma');
  expect(JSON.parse(screen.getByTestId('state').textContent!).editorial.footer.line).toBe(
    'Otra firma',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Ocultar enlace' }));
  expect(JSON.parse(screen.getByTestId('state').textContent!).editorial.footer.link).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Restaurar enlace original' }));
  expect(
    JSON.parse(screen.getByTestId('state').textContent!).editorial.footer.link,
  ).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: /Restaurar texto original: Cabecera/ }));
  expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({});
});
