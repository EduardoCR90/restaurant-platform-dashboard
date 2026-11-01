// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { observePublication } from '../shared/publication-mutation';
import { revisionFingerprint } from '../shared/publications';
function setup() {
  const journal = {
    begin: vi.fn(async () => {}),
    accept: vi.fn(async (hash: string) => {
      void hash;
    }),
    fail: vi.fn(async () => {}),
  };
  const mutate = vi.fn(async () => ({
    results: [{ id: 'dish', document: { _id: 'dish', _type: 'dish', _rev: 'revision' } }],
  }));
  const store = { query: vi.fn(), upload: vi.fn(), mutate };
  return {
    journal,
    mutate,
    tracked: observePublication(
      store,
      { projectId: 'project', dataset: 'production', documentId: 'dish' },
      journal,
    ),
  };
}
it('registra antes de Sanity y confirma la revisión exacta devuelta, no otra lectura', async () => {
  const f = setup();
  await f.tracked.mutate([]);
  expect(f.journal.begin.mock.invocationCallOrder[0]).toBeLessThan(
    f.mutate.mock.invocationCallOrder[0],
  );
  expect(f.journal.accept).toHaveBeenCalledWith(
    await revisionFingerprint('project', 'production', 'dish', 'revision'),
  );
  expect(f.journal.fail).not.toHaveBeenCalled();
});
it('un idempotency conflict o fallo del registro inicial impide la escritura', async () => {
  const f = setup();
  f.journal.begin.mockRejectedValue(new Error('duplicate'));
  await expect(f.tracked.mutate([])).rejects.toThrow('duplicate');
  expect(f.mutate).not.toHaveBeenCalled();
});
it('rechazo Sanity registra error y nunca reintenta', async () => {
  const f = setup();
  f.mutate.mockRejectedValue(new Error('Sanity'));
  await expect(f.tracked.mutate([])).rejects.toThrow('Sanity');
  expect(f.journal.fail).toHaveBeenCalledOnce();
  expect(f.mutate).toHaveBeenCalledOnce();
});
it('error de comunicación del registro posterior no repite la publicación', async () => {
  const f = setup();
  f.journal.accept.mockRejectedValue(new Error('unavailable'));
  await f.tracked.mutate([]);
  expect(f.mutate).toHaveBeenCalledOnce();
});
it('huellas separan proyectos, datasets y revisiones', async () => {
  const fingerprints = await Promise.all(
    [
      ['a', 'production', 'x', '1'],
      ['b', 'production', 'x', '1'],
      ['a', 'staging', 'x', '1'],
      ['a', 'production', 'x', '2'],
    ].map(([p, d, id, r]) => revisionFingerprint(p, d, id, r)),
  );
  expect(new Set(fingerprints).size).toBe(4);
});
