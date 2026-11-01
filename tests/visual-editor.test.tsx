import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi, afterEach } from 'vitest';
import { ThemeEditor } from '../src/features/content/ThemeEditor';
import { BlockEditor } from '../src/features/content/BlockEditor';
import { HistoricalSections } from '../src/features/content/HistoricalSections';
import type { JsonRecord } from '../shared/content';
afterEach(() => vi.restoreAllMocks());
it('preset selection and customization do not materialize inherited defaults or mutate unrelated fields', async () => {
  function Editor() {
    const [value, setValue] = useState<unknown>({
      _type: 'restaurantTheme',
      paper: '#123456',
      future: 'keep',
    });
    return (
      <>
        <ThemeEditor value={value} onChange={setValue} />
        <output data-testid="value">{JSON.stringify(value)}</output>
      </>
    );
  }
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<Editor />);
  await userEvent.selectOptions(screen.getByLabelText('Preset visual'), 'modern');
  expect(JSON.parse(screen.getByTestId('value').textContent!).paper).toBe('#123456');
  confirm.mockReturnValue(true);
  await userEvent.selectOptions(screen.getByLabelText('Preset visual'), 'modern');
  expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual({
    _type: 'restaurantTheme',
    future: 'keep',
    preset: 'modern',
  });
  await userEvent.click(screen.getByText('Personalizar colores'));
  await userEvent.type(screen.getByLabelText('Valor de color: Acento'), '#335577');
  expect(JSON.parse(screen.getByTestId('value').textContent!).accent).toBe('#335577');
  expect(screen.getByLabelText('Vista previa orientativa del tema')).toBeInTheDocument();
});
it('blocks reorder, hide and remove only after confirmation, retaining keys and data', async () => {
  function Editor() {
    const [blocks, setBlocks] = useState<JsonRecord[]>([
      { _type: 'divider', _key: 'one', title: 'Uno' },
      { _type: 'divider', _key: 'two', title: 'Dos' },
    ]);
    return (
      <>
        <BlockEditor value={blocks} onChange={setBlocks} options={{ category: [], dish: [] }} />
        <output data-testid="value">{JSON.stringify(blocks)}</output>
      </>
    );
  }
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<Editor />);
  await userEvent.click(screen.getByRole('button', { name: 'Ocultar bloque 1' }));
  let value = JSON.parse(screen.getByTestId('value').textContent!);
  expect(value[0]).toMatchObject({ _key: 'one', title: 'Uno', enabled: false });
  await userEvent.click(screen.getByRole('button', { name: 'Bajar bloque 1' }));
  value = JSON.parse(screen.getByTestId('value').textContent!);
  expect(value.map((b: JsonRecord) => b._key)).toEqual(['two', 'one']);
  await userEvent.click(screen.getByRole('button', { name: 'Quitar bloque 1' }));
  expect(JSON.parse(screen.getByTestId('value').textContent!)).toHaveLength(2);
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole('button', { name: 'Quitar bloque 1' }));
  expect(JSON.parse(screen.getByTestId('value').textContent!)[0]._key).toBe('one');
});
it('historical sections can be hidden without creating blocks or changing copy', async () => {
  function Editor() {
    const [document, setDocument] = useState<JsonRecord>({
      slug: { current: 'inicio' },
      title: 'Original',
      blocks: [],
      composition: { hero: { caption: 'Original caption' } },
    });
    return (
      <>
        <HistoricalSections document={document} onChange={setDocument} />
        <output data-testid="value">{JSON.stringify(document)}</output>
      </>
    );
  }
  render(<Editor />);
  await userEvent.click(screen.getByLabelText('Platos destacados'));
  const value = JSON.parse(screen.getByTestId('value').textContent!);
  expect(value.composition.sections.featured).toBe(false);
  expect(value.composition.hero.caption).toBe('Original caption');
  expect(value.blocks).toEqual([]);
});
it('legacy server editor does not offer unsupported hide or variant controls', () => {
  render(
    <BlockEditor
      visualEnabled={false}
      value={[{ _type: 'divider', _key: 'one' }]}
      onChange={() => {}}
      options={{ category: [], dish: [] }}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Ocultar bloque 1' })).not.toBeInTheDocument();
});
