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
function snapshot(kind: Kind, id: string, v: Awaited<ReturnType<typeof versions>>): Snapshot {
  const doc = v.draft || v.published;
  if (!doc) throw new HttpError(404, 'Documento no encontrado');
  const { _type, ...fields } = clean(doc);
  void _type;
  return {
    id,
    kind,
    draftRev: v.draft?._rev ?? null,
    publishedRev: v.published?._rev ?? null,
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
  if (req.action === 'upload') return store.upload(validateUpload(req.data, req.mime), req.mime);
  if (req.action === 'list') {
    const docs = await store.query<SanityDocument[]>(
      '*[_type == $kind && !(_id in path("versions.**"))] | order(_id asc)[0...1001]{_id,_type,_rev,title,name}',
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
      });
    }
    return [...result.values()].sort((a, b) => a.title.localeCompare(b.title, 'es'));
  }
  if (req.action === 'create') {
    if (singletonIds[req.kind])
      throw new HttpError(400, 'Los documentos únicos ya existen; edítalos desde su sección.');
    const fields = validateContent(req.kind, req.document);
    await validateReferences(store, req.kind, fields);
    // El sufijo se genera en Sanity (prefijo terminado en punto), sin IDs derivados de slugs.
    const result = await store.mutate([{ create: { ...fields, _type: req.kind, _id: 'drafts.' } }]);
    const created = result.results[0]?.id;
    if (!created?.startsWith('drafts.'))
      throw new HttpError(502, 'Sanity no devolvió el borrador esperado');
    const id = created.slice(7);
    return snapshot(req.kind, id, await versions(store, req.kind, id));
  }
  const current = await versions(store, req.kind, req.id);
  if (req.action === 'get') return snapshot(req.kind, req.id, current);
  ensureRevisions(current, req);
  if (!current.published && !current.draft) throw new HttpError(404, 'Documento no encontrado');
  if (req.action === 'save') {
    const fields = validateContent(req.kind, req.document);
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
    return snapshot(req.kind, req.id, saved);
  }
  const draft = current.draft;
  if (!draft) throw new HttpError(409, 'No hay borrador para publicar');
  const fields = validateContent(req.kind, clean(draft));
  await validateReferences(store, req.kind, fields, req.id);
  const pub = current.published;
  if (req.kind === 'page' && pub) {
    const oldSlug = (pub.slug as { current: string })?.current;
    if (
      oldSlug === 'inicio' &&
      ((fields.slug as { current: string }).current !== 'inicio' || fields.status === 'hidden')
    )
      throw new HttpError(
        422,
        'La portada existente debe conservar la ruta inicio y permanecer visible',
      );
  }
  // Una transacción: guarda de revisión de borrador, publicación condicional y eliminación SOLO del borrador.
  const guardField =
    req.kind === 'gallery' ? 'images' : ['page', 'story'].includes(req.kind) ? 'title' : 'name';
  await store.mutate([
    {
      patch: {
        id: draft._id,
        ifRevisionID: req.draftRev,
        set: { [guardField]: draft[guardField] },
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
  return snapshot(req.kind, req.id, await versions(store, req.kind, req.id));
}
