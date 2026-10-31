import { useEffect, useState, useRef, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import {
  kindSchema,
  singletonIds,
  validateContent,
  type ContentItem,
  type JsonRecord,
  type Snapshot,
} from '../../../shared/content';
import { contentApi } from '../../services/platform';
import { useRestaurant } from '../restaurants/RestaurantProvider';
import { Feedback, Loading } from '../../components/Feedback';
import { fields, initialDocument, normalizeDocument, kindLabels } from './fields';
import { FormFields, type ReferenceOptions } from './Fields';
import { BlockEditor } from './BlockEditor';
export function ContentGate({ children }: { children: React.ReactNode }) {
  const ctx = useRestaurant();
  return ctx.contentAllowed ? (
    <>{children}</>
  ) : (
    <section>
      <p className="eyebrow">Acceso editorial</p>
      <h1>Este espacio no está disponible.</h1>
      <p>
        Necesitas un restaurante activo, un rol de propietario o responsable, y el módulo de
        contenido contratado y activo.
      </p>
      <Link to="/modules">Consultar módulos</Link>
    </section>
  );
}
function ContentNav() {
  return (
    <nav className="section-nav" aria-label="Tipos de contenido">
      {(['page', 'category', 'dish', 'settings', 'story', 'gallery'] as const).map((kind) => (
        <Link
          key={kind}
          to={singletonIds[kind] ? `/content/${kind}/${singletonIds[kind]}` : `/content/${kind}`}
        >
          {kindLabels[kind]}
        </Link>
      ))}
    </nav>
  );
}
export function ContentList() {
  const { kind: raw } = useParams();
  const kind = kindSchema.safeParse(raw);
  const loadedKind = kind.success ? kind.data : null;
  const ctx = useRestaurant();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (!loadedKind || !ctx.restaurant || !ctx.contentAllowed) {
      setLoading(false);
      return;
    }
    void contentApi
      .list({ action: 'list', kind: loadedKind, restaurantId: ctx.restaurant.id })
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'No se pudo cargar');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadedKind, ctx.restaurant, ctx.contentAllowed, retry]);
  if (!kind.success) return <p>Tipo de contenido no válido.</p>;
  return (
    <ContentGate>
      <ContentNav />
      <p className="eyebrow">Edición y publicación</p>
      <div className="page-heading">
        <h1>{kindLabels[kind.data]}</h1>
        {!singletonIds[kind.data] && (
          <Link className="button primary" to={`/content/${kind.data}/new`}>
            Crear {kind.data === 'page' ? 'página' : kind.data === 'dish' ? 'plato' : 'categoría'} ↗
          </Link>
        )}
      </div>
      <p className="lede">
        Tus cambios se guardan como borrador. Publicar los envía al flujo editorial de la web.
      </p>
      <label className="search">
        Buscar
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nombre o título"
        />
      </label>
      <Feedback error={error} />
      {error && <button onClick={() => setRetry(retry + 1)}>Volver a intentar</button>}
      {loading ? (
        <Loading />
      ) : (
        <div className="content-list">
          {items
            .filter((item) => item.title.toLowerCase().includes(search.toLowerCase()))
            .map((item) => (
              <Link key={item.id} to={`/content/${kind.data}/${item.id}`}>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.draft ? 'Tiene borrador' : item.published ? 'Publicado' : 'Sin publicar'}
                  </small>
                </span>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          {!items.length && !error && (
            <p className="empty-note">
              Todavía no hay contenido de este tipo. Crea el primero para comenzar.
            </p>
          )}
        </div>
      )}
    </ContentGate>
  );
}
export function ContentEditor() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { kind: raw, id } = useParams();
  const parsed = kindSchema.safeParse(raw);
  const kind = parsed.success ? parsed.data : null;
  const ctx = useRestaurant();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [document, setDocument] = useState<JsonRecord>({});
  const [options, setOptions] = useState<ReferenceOptions>({ category: [], dish: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setDirty(false);
    setSnapshot(null);
    if (!kind || !ctx.restaurant || !id || !ctx.contentAllowed) {
      setLoading(false);
      return;
    }
    async function load() {
      const restaurantId = ctx.restaurant!.id;
      const [categories, dishes, doc] = await Promise.all([
        contentApi.list({ restaurantId, action: 'list', kind: 'category' }),
        contentApi.list({ restaurantId, action: 'list', kind: 'dish' }),
        id === 'new'
          ? Promise.resolve(null)
          : contentApi.document({ restaurantId, action: 'get', kind: kind!, id: id! }),
      ]);
      if (active) {
        setOptions({
          category: categories.filter((c) => c.published),
          dish: dishes.filter((d) => d.published),
        });
        setSnapshot(doc);
        setDocument(doc ? normalizeDocument(kind!, doc.document) : initialDocument(kind!));
      }
    }
    void load()
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'No se pudo abrir');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, id, ctx.restaurant, ctx.contentAllowed, version]);
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!kind || !id) return <p>Documento no válido.</p>;
  function change(next: JsonRecord) {
    setDocument(next);
    setDirty(true);
    setMessage('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!kind || !ctx.restaurant) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const valid = validateContent(kind, document);
      const next = await contentApi.document(
        snapshot
          ? {
              restaurantId: ctx.restaurant.id,
              action: 'save',
              kind,
              id: snapshot.id,
              draftRev: snapshot.draftRev,
              publishedRev: snapshot.publishedRev,
              document: valid,
            }
          : { restaurantId: ctx.restaurant.id, action: 'create', kind, document: valid },
      );
      if (!mounted.current) return;
      setSnapshot(next);
      setDocument(next.document);
      setDirty(false);
      setMessage('Borrador guardado. Todavía no se ha publicado.');
      if (id === 'new') navigate(`/content/${kind}/${next.id}`, { replace: true });
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ')
          : e instanceof Error
            ? e.message
            : 'No se pudo guardar',
      );
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!kind || !ctx.restaurant || !snapshot?.draftRev || dirty) return;
    if (
      !window.confirm(
        '¿Publicar este borrador? La web lo incorporará en su próxima reconstrucción.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const next = await contentApi.document({
        restaurantId: ctx.restaurant.id,
        action: 'publish',
        kind,
        id: snapshot.id,
        draftRev: snapshot.draftRev,
        publishedRev: snapshot.publishedRev,
      });
      if (!mounted.current) return;
      setSnapshot(next);
      setDocument(next.document);
      setMessage('Contenido publicado en Sanity. La web cambiará al finalizar su reconstrucción.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo publicar');
    } finally {
      setBusy(false);
    }
  }
  return (
    <ContentGate>
      <ContentNav />
      <p className="eyebrow">{kindLabels[kind]}</p>
      <div className="page-heading">
        <h1>
          {id === 'new'
            ? 'Crear contenido'
            : String(document.title || document.name || kindLabels[kind])}
        </h1>
        <span className="badge">
          {snapshot?.draftRev ? 'Borrador' : snapshot?.publishedRev ? 'Publicado' : 'Nuevo'}
        </span>
      </div>
      {loading ? (
        <Loading />
      ) : (
        <>
          <Feedback error={error} message={message} />
          <div className="editor-actions">
            <button
              onClick={() => {
                if (!dirty || window.confirm('Perderás los cambios sin guardar. ¿Recargar?'))
                  setVersion(version + 1);
              }}
              disabled={busy}
            >
              Recargar documento
            </button>
            <span className="muted">{dirty ? 'Cambios sin guardar' : 'Sin cambios locales'}</span>
          </div>
          {(!error || Object.keys(document).length > 0) && (
            <form className="editor-form" onSubmit={save}>
              <fieldset disabled={busy}>
                <FormFields
                  definitions={fields[kind]}
                  value={document}
                  onChange={change}
                  options={options}
                />
                {kind === 'page' && (
                  <BlockEditor
                    value={document.blocks}
                    onChange={(blocks) => change({ ...document, blocks })}
                    options={options}
                  />
                )}
              </fieldset>
              <div className="save-bar">
                <button className="primary" disabled={busy}>
                  Guardar borrador
                </button>
                <button
                  type="button"
                  disabled={busy || dirty || !snapshot?.draftRev}
                  onClick={() => void publish()}
                >
                  Publicar borrador ↗
                </button>
                <small>No se borra contenido publicado.</small>
              </div>
            </form>
          )}
        </>
      )}
    </ContentGate>
  );
}
