import { HttpError, type ContentStore } from './editor-service.ts';
import { revisionFingerprint } from './publications.ts';
export interface PublicationJournal {
  begin(): Promise<void>;
  accept(fingerprint: string): Promise<void>;
  fail(): Promise<void>;
}
// Invocado únicamente después de autenticar, resolver integración y validar contenido/revisiones.
// Si falla el registro inicial no se escribe. Un fallo del registro posterior nunca repite Sanity.
export function observePublication(
  store: ContentStore,
  target: { projectId: string; dataset: string; documentId: string },
  journal: PublicationJournal,
): ContentStore {
  return {
    ...store,
    async mutate(mutations) {
      await journal.begin();
      let result: Awaited<ReturnType<ContentStore['mutate']>>;
      try {
        result = await store.mutate(mutations);
      } catch (error) {
        await journal.fail().catch(() => {});
        throw error;
      }
      const published = result.results.find((r) => r.id === target.documentId)?.document;
      if (!published?._rev) {
        // La escritura puede haberse completado. No devolver un éxito inventado ni reintentar.
        throw new HttpError(
          502,
          'No se pudo confirmar la revisión publicada. Recarga antes de repetir.',
        );
      }
      const fingerprint = await revisionFingerprint(
        target.projectId,
        target.dataset,
        target.documentId,
        published._rev,
      );
      await journal.accept(fingerprint).catch(() => {
        /* El estado incierto expira explícitamente. */
      });
      return result;
    },
  };
}
