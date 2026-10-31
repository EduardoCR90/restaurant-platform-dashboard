import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider, useUnsavedChanges } from '../src/app/UnsavedChanges';
import { editorialState, editorialLabels, canWithdraw } from '../shared/editorial-state';
afterEach(() => vi.restoreAllMocks());
function Editor() {
  const guard = useUnsavedChanges();
  const [finish, setFinish] = useState<(() => void) | null>(null);
  return (
    <>
      <h1>Editor de ensayo</h1>
      <button onClick={() => guard.setDirty(true)}>Editar</button>
      <button onClick={() => guard.setDirty(false)}>Guardar</button>
      <button onClick={() => setFinish(() => guard.beginOperation())}>Iniciar operación</button>
      <button onClick={() => finish?.()}>Finalizar operación</button>
    </>
  );
}
function setup() {
  const router = createMemoryRouter(
    [
      {
        element: (
          <UnsavedChangesProvider>
            <Link to="/other">Otra sección</Link>
            <Outlet />
          </UnsavedChangesProvider>
        ),
        children: [
          { path: '/edit', element: <Editor /> },
          { path: '/other', element: <h1>Otra sección</h1> },
        ],
      },
    ],
    { initialEntries: ['/other', '/edit'] },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}
it('cancelar la navegación conserva el documento y permite confirmar un segundo intento', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { router } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
  await userEvent.click(screen.getByRole('link', { name: 'Otra sección' }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(router.state.location.pathname).toBe('/edit');
  expect(screen.getByRole('heading', { name: 'Editor de ensayo' })).toBeInTheDocument();
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole('link', { name: 'Otra sección' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
});
it('no advierte sin cambios ni después de guardar correctamente', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { router } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await userEvent.click(screen.getByRole('link', { name: 'Otra sección' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
  expect(confirm).not.toHaveBeenCalled();
});
it('intercepta atrás/adelante del router y mantiene cambios si se cancela', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { router } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
  await act(async () => {
    await router.navigate(-1);
  });
  expect(router.state.location.pathname).toBe('/edit');
  expect(confirm).toHaveBeenCalledOnce();
  confirm.mockReturnValue(true);
  await act(async () => {
    await router.navigate(-1);
  });
  await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
});
it('beforeunload solo se activa con cambios/operaciones y limpia el listener al desmontarse', async () => {
  const { unmount } = setup();
  const check = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(check()).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
  expect(check()).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(check()).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar operación' }));
  expect(check()).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Finalizar operación' }));
  expect(check()).toBe(false);
  unmount();
  expect(check()).toBe(false);
});
it('una operación en curso impide cambiar de contexto hasta finalizar', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const { router } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar operación' }));
  await userEvent.click(screen.getByRole('link', { name: 'Otra sección' }));
  expect(alert).toHaveBeenCalledOnce();
  expect(router.state.location.pathname).toBe('/edit');
  await userEvent.click(screen.getByRole('button', { name: 'Finalizar operación' }));
  await userEvent.click(screen.getByRole('link', { name: 'Otra sección' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
});
it('estados distinguen borrador persistido, pendientes, publicación y retirada', () => {
  for (const [flags, state] of [
    [{ published: false, draft: true }, 'draft'],
    [{ published: true, draft: true }, 'pending'],
    [{ published: true, draft: false }, 'published'],
    [{ published: true, draft: true, withdrawn: true }, 'withdrawn'],
  ] as const)
    expect(editorialState(flags)).toBe(state);
  expect(editorialLabels.pending).toBe('Cambios pendientes de publicar');
  expect(canWithdraw('page', { slug: { current: 'inicio' } })).toBe(false);
  expect(canWithdraw('settings', {})).toBe(false);
});
