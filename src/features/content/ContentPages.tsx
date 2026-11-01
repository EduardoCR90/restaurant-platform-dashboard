import { HistoricalSections } from './HistoricalSections';
import { PublicationStatus } from '../publications/PublicationStatus';
import { useUnsavedChanges } from '../../app/UnsavedChanges';
import { canWithdraw, editorialState, editorialLabels } from '../../../shared/editorial-state';
import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react';
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
import { contentFields, initialDocument, normalizeDocument, kindLabels } from './fields';
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
      {ctx.restaurant && (
        <PublicationStatus key={ctx.restaurant.id} restaurantId={ctx.restaurant.id} />
      )}
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
                  <small>{editorialLabels[editorialState(item)]}</small>
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
  const guard = useUnsavedChanges();
  const baseline = useRef<JsonRecord>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      guard.setDirty(false);
    };
  }, [guard]);
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
  const [publicationPending, setPublicationPending] = useState(false);
  const [publicationRefresh, setPublicationRefresh] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirty, setLocalDirty] = useState(false);
  const setDirty = useCallback(
    (value: boolean) => {
      setLocalDirty(value);
      guard.setDirty(value);
    },
    [guard],
  );
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setDirty(false);
    setSnapshot(null);
    setDocument({});
    baseline.current = {};
    setMessage('');
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
        const loaded = doc ? normalizeDocument(kind!, doc.document) : initialDocument(kind!);
        baseline.current = loaded;
        setDocument(loaded);
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
  }, [kind, id, ctx.restaurant, ctx.contentAllowed, version, setDirty]);
  if (!kind || !id) return <p>Documento no válido.</p>;
  function change(next: JsonRecord) {
    setDocument(next);
    setDirty(JSON.stringify(next) !== JSON.stringify(baseline.current));
    setMessage('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!kind || !ctx.restaurant || (id !== 'new' && !snapshot)) return;
    const finish = guard.beginOperation();
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
              visualContractVersion: 2,
              kind,
              id: snapshot.id,
              draftRev: snapshot.draftRev,
              publishedRev: snapshot.publishedRev,
              document: valid,
            }
          : {
              restaurantId: ctx.restaurant.id,
              action: 'create',
              visualContractVersion: 2,
              kind,
              document: valid,
            },
      );
      if (!mounted.current) return;
      setSnapshot(next);
      baseline.current = normalizeDocument(kind, next.document);
      setDocument(baseline.current);
      setDirty(false);
      setMessage('Borrador guardado. Todavía no se ha publicado.');
      finish();
      if (id === 'new') navigate(`/content/${kind}/${next.id}`, { replace: true });
    } catch (e) {
      if (!mounted.current) return;
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ')
          : e instanceof Error
            ? e.message
            : 'No se pudo guardar',
      );
    } finally {
      finish();
      if (mounted.current) {
        setBusy(false);
        setPublicationPending(false);
        setPublicationRefresh((n) => n + 1);
      }
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
    const finish = guard.beginOperation();
    setPublicationPending(true);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await contentApi.document({
        restaurantId: ctx.restaurant.id,
        action: 'publish',
        operationId: crypto.randomUUID(),
        kind,
        id: snapshot.id,
        draftRev: snapshot.draftRev,
        publishedRev: snapshot.publishedRev,
      });
      if (!mounted.current) return;
      setSnapshot(next);
      baseline.current = normalizeDocument(kind, next.document);
      setDocument(baseline.current);
      setDirty(false);
      setMessage('Contenido publicado en Sanity. La web cambiará al finalizar su reconstrucción.');
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'No se pudo publicar');
    } finally {
      finish();
      if (mounted.current) {
        setBusy(false);
        setPublicationPending(false);
        setPublicationRefresh((n) => n + 1);
      }
    }
  }
  async function editorialAction(action: 'discard' | 'withdraw' | 'restore') {
    if (!ctx.restaurant || !kind || !id) return;
    const text =
      action === 'discard'
        ? snapshot?.draftRev
          ? snapshot.publishedRev
            ? '¿Descartar el borrador y los cambios locales? Se conservará la versión publicada.'
            : '¿Descartar este documento nunca publicado? Se eliminará únicamente su borrador y los cambios locales.'
          : '¿Descartar los cambios locales sin guardar?'
        : action === 'withdraw'
          ? '¿Retirar de publicación? Se conservarán todos los datos. La web cambiará tras reconstruirse.' +
            (kind === 'category'
              ? ' Sus platos también dejarán de mostrarse hasta recuperar la categoría.'
              : '')
          : '¿Volver a publicar? Se incorporará el borrador guardado, si existe. La web cambiará al finalizar su reconstrucción.';
    if (!window.confirm(text)) return;
    if (action === 'discard' && !snapshot?.draftRev) {
      setDocument(baseline.current);
      setDirty(false);
      setMessage('Cambios locales descartados.');
      return;
    }
    if (!snapshot) return;
    const finish = guard.beginOperation();
    setPublicationPending(action !== 'discard');
    setBusy(true);
    setError('');
    setMessage('');
    const request = {
      restaurantId: ctx.restaurant.id,
      kind,
      id: snapshot.id,
      draftRev: snapshot.draftRev,
      publishedRev: snapshot.publishedRev,
    };
    try {
      const next =
        action === 'discard'
          ? (await contentApi.discard({ ...request, action })).snapshot
          : await contentApi.document({ ...request, action, operationId: crypto.randomUUID() });
      if (!mounted.current) return;
      setDirty(false);
      if (!next) {
        finish();
        navigate(`/content/${kind}`, { replace: true });
        return;
      }
      setSnapshot(next);
      baseline.current = normalizeDocument(kind, next.document);
      setDocument(baseline.current);
      setMessage(
        action === 'discard'
          ? 'Borrador descartado. Se ha recuperado la versión anterior.'
          : action === 'withdraw'
            ? 'Contenido retirado en Sanity. La web lo ocultará tras su reconstrucción.'
            : 'Contenido publicado de nuevo en Sanity. La web cambiará tras su reconstrucción.',
      );
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : 'No se pudo completar la operación');
    } finally {
      finish();
      if (mounted.current) {
        setBusy(false);
        setPublicationPending(false);
        setPublicationRefresh((n) => n + 1);
      }
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
          {snapshot
            ? editorialLabels[
                editorialState({
                  draft: !!snapshot.draftRev,
                  published: !!snapshot.publishedRev,
                  withdrawn: snapshot.withdrawn,
                })
              ]
            : 'Nuevo · sin guardar'}
        </span>
      </div>
      {ctx.restaurant && id !== 'new' && (
        <PublicationStatus
          key={`${ctx.restaurant.id}:${id}`}
          restaurantId={ctx.restaurant.id}
          documentId={id}
          publishing={publicationPending}
          refresh={publicationRefresh}
        />
      )}
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
            <span className="muted">
              {dirty
                ? 'Cambios locales sin guardar'
                : snapshot?.draftRev
                  ? 'Borrador guardado en Sanity'
                  : 'Sin cambios locales'}
            </span>
          </div>
          {snapshot?.withdrawn && snapshot.draftRev && (
            <p>Hay cambios guardados pendientes. Volver a publicar incorporará ese borrador.</p>
          )}
          {!!snapshot?.publishedRev && !!snapshot.draftRev && !snapshot.withdrawn && (
            <p>Publica o descarta el borrador pendiente antes de retirar el contenido.</p>
          )}
          <p className="muted">
            Los estados se refieren a Sanity. La web se actualiza al finalizar su reconstrucción.
            Retirar una categoría oculta también sus platos.
          </p>
          {(!error || Object.keys(document).length > 0) && (
            <form className="editor-form" onSubmit={save}>
              {kind === 'page' && (
                <p>
                  Sin bloques se conserva la composición original de las páginas habituales. Añadir
                  bloques sustituye esa composición completa; no los añadas para cambiar solo un
                  texto.
                </p>
              )}
              {kind === 'settings' && snapshot?.visualContractVersion !== 2 && (
                <p role="status">
                  La configuración visual estará disponible al completar la actualización del
                  servidor. Recarga el documento después.
                </p>
              )}
              {!ctx.data?.admin && (
                <p className="muted">
                  Puedes editar contenidos, orden y visibilidad. El diseño global, el branding y la
                  estructura los configura Super Admin.
                </p>
              )}
              {snapshot?.permissions?.designDraft && !snapshot.permissions.manageDesign && (
                <p role="status">
                  Este borrador incluye cambios de diseño de Super Admin. Su publicación o descarte
                  requiere Super Admin.
                </p>
              )}
              <fieldset disabled={busy}>
                <FormFields
                  definitions={contentFields(
                    kind,
                    document,
                    snapshot?.visualContractVersion === 2,
                    ctx.data?.admin === true && snapshot?.permissions?.manageDesign === true,
                  )}
                  value={document}
                  onChange={change}
                  options={options}
                />
                {kind === 'page' && snapshot?.visualContractVersion === 2 && (
                  <HistoricalSections document={document} onChange={change} />
                )}
                {kind === 'page' && (
                  <BlockEditor
                    manageDesign={
                      ctx.data?.admin === true &&
                      (id === 'new' || snapshot?.permissions?.manageDesign === true)
                    }
                    visualEnabled={snapshot?.visualContractVersion === 2}
                    historical={['inicio', 'carta', 'restaurante', 'reservas'].includes(
                      String((document.slug as { current?: string })?.current),
                    )}
                    value={document.blocks}
                    onChange={(blocks) => change({ ...document, blocks })}
                    options={options}
                  />
                )}
              </fieldset>
              <div className="save-bar">
                <button className="primary" disabled={busy || !dirty}>
                  Guardar borrador
                </button>
                {!snapshot?.withdrawn && (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      dirty ||
                      !snapshot?.draftRev ||
                      (!!snapshot.permissions?.designDraft && !snapshot.permissions.manageDesign)
                    }
                    onClick={() => void publish()}
                  >
                    Publicar cambios ↗
                  </button>
                )}
                {(dirty || snapshot?.draftRev) && (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      (!!snapshot?.permissions?.designDraft && !snapshot.permissions.manageDesign)
                    }
                    onClick={() => void editorialAction('discard')}
                  >
                    Descartar cambios
                  </button>
                )}
                {snapshot?.publishedRev &&
                  canWithdraw(kind, document) &&
                  (snapshot.withdrawn ? (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        dirty ||
                        (!!snapshot.permissions?.designDraft && !snapshot.permissions.manageDesign)
                      }
                      onClick={() => void editorialAction('restore')}
                    >
                      Volver a publicar
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || dirty || !!snapshot.draftRev}
                      onClick={() => void editorialAction('withdraw')}
                    >
                      Retirar de publicación
                    </button>
                  ))}
                <small>No se borra contenido publicado.</small>
              </div>
            </form>
          )}
        </>
      )}
    </ContentGate>
  );
}
