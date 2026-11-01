import { useEffect, useState } from 'react';
import {
  publicationErrors,
  publicationLabels,
  type Publication,
} from '../../../shared/publications';
import { listPublications } from '../../services/platform';
export function PublicationStatus({
  restaurantId,
  documentId,
  publishing = false,
  refresh = 0,
}: {
  restaurantId: string;
  documentId?: string;
  publishing?: boolean;
  refresh?: number;
}) {
  const [items, setItems] = useState<Publication[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setItems([]);
    setError(false);
    async function load() {
      try {
        const result = await listPublications(restaurantId, documentId);
        if (active) {
          setItems(result);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        if (active) timer = setTimeout(() => void load(), 8000);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [restaurantId, documentId, refresh, publishing]);
  return (
    <section aria-label="Actualización de la web" className="publication-status">
      <h2>Actualización de la web</h2>
      {publishing && <p role="status">Publicando en Sanity…</p>}
      {error && (
        <p role="status">
          No se puede consultar el estado ahora. Puedes seguir editando; no se ha confirmado una
          actualización de la web.
        </p>
      )}
      <div aria-live="polite" aria-atomic="true">
        {items.slice(0, documentId ? 1 : 3).map((item) => (
          <div key={item.id}>
            <strong>{publicationLabels[item.state]}</strong>
            <p className="muted">
              {new Date(item.created_at).toLocaleString('es-ES')}
              {!documentId
                ? ` · ${item.action === 'withdraw' ? 'Retirada' : item.action === 'restore' ? 'Recuperación' : 'Publicación'}`
                : ''}
            </p>
            {item.error_code && (
              <p>
                {publicationErrors[item.error_code] ||
                  'No se pudo confirmar la actualización. Contacta con el administrador antes de repetir la operación.'}
              </p>
            )}
          </div>
        ))}
        {!items.length && !error && !publishing && (
          <p className="muted">
            Aquí aparecerá el estado de las próximas publicaciones. Guardar un borrador no actualiza
            la web.
          </p>
        )}
      </div>
    </section>
  );
}
