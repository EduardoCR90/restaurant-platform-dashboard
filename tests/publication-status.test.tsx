import { render, screen, waitFor } from '@testing-library/react';
import { it, expect, vi, beforeEach } from 'vitest';
import { PublicationStatus } from '../src/features/publications/PublicationStatus';
import { listPublications } from '../src/services/platform';
import type { Publication } from '../shared/publications';
vi.mock('../src/services/platform', () => ({ listPublications: vi.fn() }));
const row: Publication = {
  id: '00000000-0000-4000-8000-000000000001',
  restaurant_id: 'a',
  actor_id: 'user',
  document_id: 'dish',
  action: 'publish',
  state: 'awaiting_deployment',
  error_code: null,
  created_at: '2026-10-31T00:00:00Z',
  accepted_at: '2026-10-31T00:00:01Z',
  completed_at: null,
  run_id: null,
  run_attempt: null,
};
beforeEach(() => {
  vi.mocked(listPublications).mockReset();
});
it('distingue aceptación Sanity de confirmación de la web', async () => {
  vi.mocked(listPublications).mockResolvedValue([row]);
  const view = render(<PublicationStatus restaurantId="a" documentId="dish" publishing />);
  expect(screen.getByText('Publicando en Sanity…')).toBeInTheDocument();
  expect(
    await screen.findByText('Publicado en Sanity, pendiente de despliegue'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Web actualizada')).not.toBeInTheDocument();
  vi.mocked(listPublications).mockResolvedValue([
    { ...row, state: 'updated', run_id: '123', run_attempt: 1 },
  ]);
  view.rerender(<PublicationStatus restaurantId="a" documentId="dish" refresh={1} />);
  expect(await screen.findByText('Web actualizada')).toBeInTheDocument();
});
it('informa fallo de consulta sin inventar actualización ni bloquear edición', async () => {
  vi.mocked(listPublications).mockRejectedValue(new Error('private response'));
  render(<PublicationStatus restaurantId="a" />);
  expect(await screen.findByText(/No se puede consultar el estado/)).toBeInTheDocument();
  expect(screen.queryByText('Web actualizada')).not.toBeInTheDocument();
  expect(screen.queryByText('private response')).not.toBeInTheDocument();
});
it('descarta respuesta tardía del restaurante anterior', async () => {
  let resolve!: (value: Publication[]) => void;
  vi.mocked(listPublications)
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce([]);
  const view = render(<PublicationStatus restaurantId="a" />);
  view.rerender(<PublicationStatus restaurantId="b" />);
  resolve([{ ...row, state: 'updated' }]);
  await waitFor(() => expect(listPublications).toHaveBeenLastCalledWith('b', undefined));
  expect(screen.queryByText('Web actualizada')).not.toBeInTheDocument();
});
