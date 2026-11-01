import { managedVisualKeys } from './visual.ts';
import { designChanged, designBlockFields } from './editorial-permissions.ts';
import { isWithdrawn, canWithdraw } from './editorial-state.ts';
import {
  contentRequest,
  documentSchemas,
  documentId,
  singletonIds,
  validateContent,
  type ContentRequest,
  type Kind,
  type JsonRecord,
  type Snapshot,
  type ContentItem,
} from './content.ts';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type SanityDocument = JsonRecord & { _id: string; _type: string; _rev: string };
export interface ContentStore {
  query<T>(query: string, params: Record<string, unknown>): Promise<T>;
  mutate(
    mutations: JsonRecord[],
  ): Promise<{ results: { id: string; document?: SanityDocument }[] }>;
  upload(bytes: Uint8Array, mime: string): Promise<{ _id: string; url: string }>;
}
export interface ContentDependencies {
  authorize(restaurantId: string): Promise<ContentStore>;
  canManageDesign?(restaurantId: string): Promise<boolean>;
}
function clean(doc: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(doc).filter(
      ([k]) => !['_id', '_type', '_rev', '_createdAt', '_updatedAt'].includes(k),
    ),
  );
}
function checkId(kind: Kind, id: string) {
  documentId.parse(id);
  const singleton = singletonIds[kind];
  if (singleton && singleton !== id) throw new HttpError(400, 'ID singleton incorrecto');
}
async function versions(store: ContentStore, kind: Kind, id: string) {
  checkId(kind, id);
  const docs = await store.query<SanityDocument[]>('*[_id in [$id,$draft]]', {
    id,
    draft: `drafts.${id}`,
  });
  if (docs.some((doc) => doc._type !== kind))
    throw new HttpError(400, 'El documento no corresponde al tipo solicitado');
  return {
    published: docs.find((d) => d._id === id),
    draft: docs.find((d) => d._id === `drafts.${id}`),
  };
}
function ensureRevisions(
  current: Awaited<ReturnType<typeof versions>>,
  expected: { publishedRev: string | null; draftRev: string | null },
) {
  if (
    (current.published?._rev ?? null) !== expected.publishedRev ||
    (current.draft?._rev ?? null) !== expected.draftRev
  )
    throw new HttpError(409, 'El contenido cambió en otra sesión. Recarga antes de continuar.');
}
function snapshot(
  kind: Kind,
  id: string,
  v: Awaited<ReturnType<typeof versions>>,
  manageDesign = false,
): Snapshot {
  const doc = v.draft || v.published;
  if (!doc) throw new HttpError(404, 'Documento no encontrado');
  const { _type, ...fields } = clean(doc);
  void _type;
  return {
    id,
    kind,
    visualContractVersion: 2,
    permissions: {
      contractVersion: 1,
      manageDesign,
      designDraft: !!v.draft && designChanged(kind, v.published, v.draft),
    },
    draftRev: v.draft?._rev ?? null,
    publishedRev: v.published?._rev ?? null,
    withdrawn: isWithdrawn(kind, v.published),
    document: Object.fromEntries(
      Object.entries(fields).filter(([key]) =>
        Object.keys(documentSchemas[kind].shape).includes(key),
      ),
    ),
  };
}
function mergeFields(original: JsonRecord, kind: Kind, fields: JsonRecord): JsonRecord {
  const merged = { ...clean(original), ...fields };
  for (const key of Object.keys(documentSchemas[kind].shape))
    if (!(key in fields)) delete merged[key];
  return merged;
}
function requiresVisualClient(kind: Kind, original: JsonRecord | undefined): boolean {
  if (!original) return false;
  if (kind === 'settings' && original.theme && typeof original.theme === 'object') {
    const legacy = ['_type', 'name', 'paper', 'ink', 'accent', 'font', 'button', 'cards'];
    return Object.keys(original.theme).some(
      (key) => managedVisualKeys.includes(key) && !legacy.includes(key),
    );
  }
  if (kind === 'page') {
    if ((original.composition as JsonRecord | undefined)?.sections) return true;
    return (
      Array.isArray(original.blocks) &&
      original.blocks.some(
        (block) =>
          block &&
          typeof block === 'object' &&
          ('enabled' in block ||
            'featuredOnly' in block ||
            ('variant' in block && !['editorial', 'compact', undefined].includes(block.variant))),
      )
    );
  }
  return false;
}
function preserveVisualExtensions(
  kind: Kind,
  fields: JsonRecord,
  original: JsonRecord | undefined,
) {
  if (
    kind !== 'settings' ||
    !fields.theme ||
    typeof fields.theme !== 'object' ||
    !original?.theme ||
    typeof original.theme !== 'object'
  )
    return;
  const unmanaged = Object.fromEntries(
    Object.entries(original.theme as JsonRecord).filter(
      ([key]) => !managedVisualKeys.includes(key) && key !== '_type',
    ),
  );
  fields.theme = { ...unmanaged, ...(fields.theme as JsonRecord) };
}
function unsetFields(kind: Kind, fields: JsonRecord) {
  return Object.keys(documentSchemas[kind].shape).filter((key) => !(key in fields));
}
async function validateReferences(store: ContentStore, kind: Kind, doc: JsonRecord, id?: string) {
  const expected = new Map<string, Set<string>>();
  function walk(value: unknown, field = '') {
    if (Array.isArray(value)) {
      value.forEach((x) => walk(x, field));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as JsonRecord;
    if (record._type === 'reference' && typeof record._ref === 'string') {
      const target =
        field === 'asset'
          ? 'sanity.imageAsset'
          : ['category', 'categories'].includes(field)
            ? 'category'
            : field === 'dishes'
              ? 'dish'
              : 'invalid';
      const targets = expected.get(record._ref) || new Set<string>();
      targets.add(target);
      expected.set(record._ref, targets);
    }
    for (const [name, v] of Object.entries(record)) walk(v, name);
  }
  walk(doc);
  if (expected.size) {
    const docs = await store.query<{ _id: string; _type: string }[]>('*[_id in $ids]{_id,_type}', {
      ids: [...expected.keys()],
    });
    for (const [ref, types] of expected)
      if (![...types].every((type) => docs.some((d) => d._id === ref && d._type === type)))
        throw new HttpError(
          422,
          'Referencia no publicada, inexistente o de tipo incorrecto. Publica primero las categorías referenciadas.',
        );
  }
  if (kind === 'page') {
    const slug = (doc.slug as { current: string }).current;
    const found = await store.query<{ _id: string }[]>(
      '*[_type == "page" && slug.current == $slug && !(_id in [$id,$draft])][0...1]{_id}',
      { slug, id: id ?? '', draft: id ? `drafts.${id}` : '' },
    );
    if (found.length) throw new HttpError(409, 'Ya existe una página con esa ruta.');
  }
}

function guardField(kind: Kind) {
  return kind === 'gallery' ? 'images' : ['page', 'story'].includes(kind) ? 'title' : 'name';
}
function revisionGuard(kind: Kind, doc: SanityDocument, rev: string | null): JsonRecord {
  const field = guardField(kind);
  return {
    patch: {
      id: doc._id,
      ifRevisionID: rev,
      set: { [field]: doc[field] ?? (kind === 'gallery' ? [] : '') },
    },
  };
}
function internalSlug(href: unknown): string | undefined {
  if (
    typeof href !== 'string' ||
    !(href.startsWith('/') || href.startsWith('https://')) ||
    href.startsWith('//')
  )
    return;
  try {
    return (
      decodeURIComponent(new URL(href, 'https://internal.invalid').pathname)
        .split('/')
        .filter(Boolean)
        .at(-1) || 'inicio'
    );
  } catch {
    return;
  }
}
function linkSlugs(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => linkSlugs(item, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, item] of Object.entries(value)) {
    const slug = key === 'href' ? internalSlug(item) : undefined;
    if (slug) found.add(slug);
    else if (key !== 'href') linkSlugs(item, found);
  }
  return found;
}
function protectCorePageIdentity(published: SanityDocument | undefined, fields: JsonRecord) {
  const old = (published?.slug as { current?: string } | undefined)?.current;
  if (
    old &&
    ['inicio', 'carta', 'restaurante', 'reservas'].includes(old) &&
    (fields.slug as { current?: string } | undefined)?.current !== old
  )
    throw new HttpError(
      422,
      'Las páginas principales deben conservar su ruta; puedes editar sus textos y navegación',
    );
  if (old === 'inicio' && fields.status === 'hidden')
    throw new HttpError(422, 'La portada debe permanecer publicada');
}
async function preventLinkedPageWithdrawal(store: ContentStore, doc: SanityDocument) {
  const slug = (doc.slug as { current: string }).current;
  const sources = await store.query<JsonRecord[]>(
    '*[_type in $linkTypes && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && _id != $id][0...1001]{_id,blocks,composition,editorial}',
    { linkTypes: ['page', 'settings'], id: doc._id },
  );
  if (sources.length > 1000)
    throw new HttpError(
      422,
      'Hay demasiados documentos para comprobar los enlaces de forma segura',
    );
  if (sources.some((source) => linkSlugs(source).has(slug)))
    throw new HttpError(
      422,
      'Otras páginas o enlaces apuntan a esta página. Actualiza esos enlaces antes de retirarla.',
    );
}
async function preventLinksToWithdrawnPages(
  store: ContentStore,
  kind: Kind,
  fields: JsonRecord,
  id: string,
) {
  if (!['page', 'settings'].includes(kind) || (kind === 'page' && fields.status === 'hidden'))
    return;
  const slugs = [...linkSlugs(fields)];
  if (!slugs.length) return;
  const hidden = await store.query<{ _id: string }[]>(
    '*[_type == "page" && status == "hidden" && slug.current in $linkSlugs && _id != $id && !(_id in path("drafts.**"))][0...1]{_id}',
    { linkSlugs: slugs, id },
  );
  if (hidden.length)
    throw new HttpError(
      422,
      'Hay enlaces a páginas retiradas. Recupera la página o actualiza sus enlaces antes de publicar.',
    );
}
export function validateUpload(data: string, mime: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw new HttpError(422, 'Imagen codificada incorrectamente');
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024)
    throw new HttpError(413, 'Máximo 8 MiB por imagen');
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  const webp =
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!(
    (mime === 'image/jpeg' && jpg) ||
    (mime === 'image/png' && png) ||
    (mime === 'image/webp' && webp)
  ))
    throw new HttpError(422, 'El archivo no coincide con su tipo de imagen');
  return bytes;
}
export async function executeContent(input: unknown, deps: ContentDependencies): Promise<unknown> {
  const req: ContentRequest = contentRequest.parse(input);
  // Siempre antes de leer documentos o subir imágenes: JWT, tenant, rol, estado y módulo.
  const store = await deps.authorize(req.restaurantId);
  // Resolved by a fresh server-side RPC, never by request fields or Auth metadata.
  const manageDesign = (await deps.canManageDesign?.(req.restaurantId)) === true;
  const view = (kind: Kind, id: string, v: Awaited<ReturnType<typeof versions>>) =>
    snapshot(kind, id, v, manageDesign);
  const guardDesign = (kind: Kind, before: unknown, after: unknown) => {
    if (
      after &&
      typeof after === 'object' &&
      'modules' in after &&
      !manageDesign &&
      req.action === 'save' &&
      'document' in req &&
      'modules' in req.document
    )
      throw new HttpError(
        403,
        'Los módulos operativos se gestionan exclusivamente en la plataforma.',
      );
    if (!manageDesign && designChanged(kind, before, after))
      throw new HttpError(
        403,
        'Solo Super Admin puede cambiar diseño, branding o estructura de bloques. Puedes editar contenido, orden y visibilidad.',
      );
  };
  // Hidden controls are still part of the document. Retain protected server
  // values byte-for-byte when Zod normalizes/strips metadata on editorial saves.
  const retainDesign = (kind: Kind, original: JsonRecord | undefined, fields: JsonRecord) => {
    if (manageDesign) return;
    if (kind === 'settings') {
      for (const key of ['theme', 'logo']) {
        if (original && key in original) fields[key] = structuredClone(original[key]);
        else delete fields[key];
      }
    } else if (kind === 'page' && Array.isArray(fields.blocks)) {
      const originalBlocks = new Map(
        (Array.isArray(original?.blocks) ? original.blocks : []).map((block: JsonRecord) => [
          block._key,
          block,
        ]),
      );
      fields.blocks = fields.blocks.map((block: JsonRecord) => {
        const old = originalBlocks.get(block._key);
        for (const key of designBlockFields) {
          if (old && key in old) block[key] = structuredClone(old[key]);
          else delete block[key];
        }
        return block;
      });
    }
    guardDesign(kind, original, fields);
  };
  if (req.action === 'upload') return store.upload(validateUpload(req.data, req.mime), req.mime);
  if (req.action === 'list') {
    const docs = await store.query<SanityDocument[]>(
      '*[_type == $kind && !(_id in path("versions.**"))] | order(_id asc)[0...1001]{_id,_type,_rev,title,name,visible,status,slug}',
      { kind: req.kind },
    );
    if (docs.length > 1000)
      throw new HttpError(
        422,
        'Colección demasiado grande para esta versión del editor. Solicita paginación de servidor.',
      );
    const result = new Map<string, ContentItem>();
    for (const doc of docs) {
      const id = doc._id.replace(/^drafts\./, '');
      const previous = result.get(id);
      const isDraft = doc._id.startsWith('drafts.');
      result.set(id, {
        id,
        title: String(
          (isDraft ? doc.title || doc.name : previous?.title) || doc.title || doc.name || id,
        ),
        draft: isDraft || previous?.draft || false,
        published: !isDraft || previous?.published || false,
        withdrawn: isDraft ? previous?.withdrawn || false : isWithdrawn(req.kind, doc),
      });
    }
    return [...result.values()].sort((a, b) => a.title.localeCompare(b.title, 'es'));
  }
  if (req.action === 'create') {
    if (singletonIds[req.kind])
      throw new HttpError(400, 'Los documentos únicos ya existen; edítalos desde su sección.');
    guardDesign(req.kind, undefined, req.document);
    const fields = validateContent(req.kind, req.document);
    retainDesign(req.kind, undefined, fields);
    await validateReferences(store, req.kind, fields);
    // El sufijo se genera en Sanity (prefijo terminado en punto), sin IDs derivados de slugs.
    const result = await store.mutate([{ create: { ...fields, _type: req.kind, _id: 'drafts.' } }]);
    const created = result.results[0]?.id;
    if (!created?.startsWith('drafts.'))
      throw new HttpError(502, 'Sanity no devolvió el borrador esperado');
    const id = created.slice(7);
    return view(req.kind, id, await versions(store, req.kind, id));
  }
  const current = await versions(store, req.kind, req.id);
  if (req.action === 'get') return view(req.kind, req.id, current);
  ensureRevisions(current, req);
  if (!current.published && !current.draft) throw new HttpError(404, 'Documento no encontrado');
  if (req.action === 'discard') {
    if (!current.draft) throw new HttpError(409, 'No hay borrador para descartar');
    guardDesign(req.kind, current.published, current.draft);
    await store.mutate([
      revisionGuard(req.kind, current.draft, req.draftRev),
      { delete: { id: current.draft._id } },
    ]);
    const next = await versions(store, req.kind, req.id);
    if (next.draft)
      throw new HttpError(
        409,
        'Se descartó el borrador anterior, pero existe uno nuevo de otra sesión. Recarga para revisar.',
      );
    return {
      discarded: true,
      id: req.id,
      kind: req.kind,
      snapshot: next.published ? view(req.kind, req.id, next) : null,
    };
  }
  if (req.action === 'withdraw' || req.action === 'restore') {
    const published = current.published;
    if (!published) throw new HttpError(409, 'El contenido no tiene versión publicada');
    if (!canWithdraw(req.kind, published))
      throw new HttpError(422, 'La portada y los documentos estructurales no se pueden retirar');
    if (req.action === 'withdraw') {
      if (current.draft)
        throw new HttpError(
          409,
          'Publica o descarta el borrador pendiente antes de retirar el contenido',
        );
      if (isWithdrawn(req.kind, published))
        throw new HttpError(409, 'El contenido ya está retirado');
      if (req.kind === 'page') await preventLinkedPageWithdrawal(store, published);
      await store.mutate([
        {
          patch: {
            id: req.id,
            ifRevisionID: req.publishedRev,
            set: req.kind === 'page' ? { status: 'hidden' } : { visible: false },
          },
        },
      ]);
      return view(req.kind, req.id, await versions(store, req.kind, req.id));
    }
    if (!isWithdrawn(req.kind, published))
      throw new HttpError(409, 'El contenido no está retirado');
    const restored = req.kind === 'page' ? { status: 'published' } : { visible: true };
    guardDesign(req.kind, published, current.draft || published);
    const fields = validateContent(req.kind, { ...clean(current.draft || published), ...restored });
    preserveVisualExtensions(req.kind, fields, current.draft || published);
    retainDesign(req.kind, published, fields);
    if (req.kind === 'page') protectCorePageIdentity(published, fields);
    await validateReferences(store, req.kind, fields, req.id);
    await preventLinksToWithdrawnPages(store, req.kind, fields, req.id);
    if (current.draft)
      await store.mutate([
        revisionGuard(req.kind, current.draft, req.draftRev),
        {
          patch: {
            id: req.id,
            ifRevisionID: req.publishedRev,
            set: { ...clean(current.draft), ...fields },
            unset: unsetFields(req.kind, fields),
          },
        },
        { delete: { id: current.draft._id } },
      ]);
    else
      await store.mutate([
        { patch: { id: req.id, ifRevisionID: req.publishedRev, set: restored } },
      ]);
    return view(req.kind, req.id, await versions(store, req.kind, req.id));
  }
  if (
    req.action === 'save' &&
    req.visualContractVersion !== 2 &&
    requiresVisualClient(req.kind, current.draft || current.published)
  )
    throw new HttpError(
      409,
      'Recarga el dashboard para editar esta configuración visual sin perder campos.',
    );
  if (req.action === 'save') {
    guardDesign(req.kind, current.draft || current.published, req.document);
    const fields = validateContent(req.kind, req.document);
    preserveVisualExtensions(req.kind, fields, current.draft || current.published);
    retainDesign(req.kind, current.draft || current.published, fields);
    await validateReferences(store, req.kind, fields, req.id);
    if (current.draft) {
      await store.mutate([
        {
          patch: {
            id: current.draft._id,
            ifRevisionID: req.draftRev,
            set: fields,
            unset: unsetFields(req.kind, fields),
          },
        },
      ]);
    } else {
      await store.mutate([
        {
          create: {
            ...mergeFields(current.published!, req.kind, fields),
            _type: req.kind,
            _id: `drafts.${req.id}`,
          },
        },
      ]);
    }
    const saved = await versions(store, req.kind, req.id);
    if ((saved.published?._rev ?? null) !== req.publishedRev)
      throw new HttpError(
        409,
        'Se guardó el borrador, pero cambió la versión publicada. Recarga y revisa antes de publicar.',
      );
    return view(req.kind, req.id, saved);
  }
  const draft = current.draft;
  if (!draft) throw new HttpError(409, 'No hay borrador para publicar');
  guardDesign(req.kind, current.published, draft);
  const fields = validateContent(req.kind, clean(draft));
  preserveVisualExtensions(req.kind, fields, draft);
  retainDesign(req.kind, current.published, fields);
  await validateReferences(store, req.kind, fields, req.id);
  const pub = current.published;
  if (req.kind === 'page') protectCorePageIdentity(pub, fields);
  if (req.kind === 'page' && pub && fields.status === 'hidden' && pub.status !== 'hidden')
    await preventLinkedPageWithdrawal(store, pub);
  await preventLinksToWithdrawnPages(store, req.kind, fields, req.id);
  // Una transacción: guarda de revisión de borrador, publicación condicional y eliminación SOLO del borrador.
  const field = guardField(req.kind);
  await store.mutate([
    {
      patch: {
        id: draft._id,
        ifRevisionID: req.draftRev,
        set: { [field]: draft[field] },
      },
    },
    pub
      ? {
          patch: {
            id: req.id,
            ifRevisionID: req.publishedRev,
            set: { ...clean(draft), ...fields },
            unset: unsetFields(req.kind, fields),
          },
        }
      : { create: { ...clean(draft), ...fields, _id: req.id, _type: req.kind } },
    { delete: { id: draft._id } },
  ]);
  return view(req.kind, req.id, await versions(store, req.kind, req.id));
}
