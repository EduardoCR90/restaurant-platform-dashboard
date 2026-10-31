import type { Kind, Block } from '../../../shared/content';
import { compositionField, editorialField, compositionSections } from './editorial-fields';
export type Field = {
  name: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'boolean'
    | 'select'
    | 'image'
    | 'link'
    | 'references'
    | 'reference'
    | 'strings'
    | 'array'
    | 'richtext'
    | 'object';
  options?: readonly string[];
  fields?: Field[];
  initial?: Record<string, unknown>;
  target?: 'category' | 'dish';
  required?: boolean;
  resettable?: boolean;
};
const title: Field = { name: 'title', label: 'Título', type: 'textarea', required: true };
const picture: Field = { name: 'image', label: 'Imagen', type: 'image' };
const cta: Field = { name: 'cta', label: 'Enlace de acción', type: 'link' };
const seo: Field = {
  name: 'seo',
  label: 'SEO',
  type: 'object',
  fields: [
    { name: 'title', label: 'Título SEO', type: 'text', required: true },
    {
      name: 'description',
      label: 'Descripción (máximo 180 caracteres)',
      type: 'textarea',
      required: true,
    },
    { ...picture, label: 'Imagen para compartir' },
  ],
};
const order: Field = { name: 'order', label: 'Orden', type: 'number', required: true };
const visible: Field = { name: 'visible', label: 'Visible en la web', type: 'boolean' };
export const kindLabels: Record<Kind, string> = {
  page: 'Páginas',
  category: 'Categorías',
  dish: 'Platos',
  settings: 'Configuración editorial',
  story: 'Historia y chef',
  gallery: 'Galería',
};
export const fields: Record<Kind, Field[]> = {
  page: [
    title,
    {
      name: 'slug',
      label: 'Ruta',
      type: 'object',
      fields: [
        { name: 'current', label: 'Slug (minúsculas y guiones)', type: 'text', required: true },
      ],
    },
    { name: 'eyebrow', label: 'Antetítulo', type: 'text' },
    { name: 'intro', label: 'Introducción', type: 'textarea' },
    {
      name: 'status',
      label: 'Visibilidad pública',
      type: 'select',
      options: ['published', 'hidden'],
    },
    { name: 'showInNavigation', label: 'Mostrar en navegación', type: 'boolean' },
    { name: 'navigationLabel', label: 'Nombre en navegación', type: 'text' },
    { name: 'navigationOrder', label: 'Orden en navegación', type: 'number' },
    picture,
    seo,
    { name: 'noindex', label: 'Excluir de buscadores', type: 'boolean' },
    compositionField,
  ],
  category: [
    { name: 'name', label: 'Nombre', type: 'text', required: true },
    { name: 'note', label: 'Nota editorial', type: 'text' },
    order,
    visible,
  ],
  dish: [
    { name: 'name', label: 'Nombre', type: 'text', required: true },
    { name: 'description', label: 'Descripción', type: 'textarea', required: true },
    { name: 'price', label: 'Precio (€)', type: 'number', required: true },
    {
      name: 'category',
      label: 'Categoría publicada',
      type: 'reference',
      target: 'category',
      required: true,
    },
    { name: 'allergens', label: 'Alérgenos (uno por línea)', type: 'strings' },
    { name: 'tags', label: 'Etiquetas (una por línea)', type: 'strings' },
    picture,
    order,
    visible,
    { name: 'available', label: 'Disponible', type: 'boolean' },
    { name: 'featured', label: 'Destacado', type: 'boolean' },
  ],
  settings: [
    { name: 'name', label: 'Nombre', type: 'text', required: true },
    { name: 'tagline', label: 'Firma', type: 'text', required: true },
    { name: 'concept', label: 'Concepto', type: 'textarea', required: true },
    { name: 'address', label: 'Dirección', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'text', required: true },
    { name: 'phone', label: 'Teléfono', type: 'text', required: true },
    { name: 'isFictional', label: 'Restaurante ficticio / demostración', type: 'boolean' },
    { name: 'reservationUrl', label: 'Proveedor real de reservas (HTTPS)', type: 'text' },
    {
      name: 'hours',
      label: 'Horarios',
      type: 'array',
      initial: { _type: 'openingHours', days: '', time: '' },
      fields: [
        { name: 'days', label: 'Días', type: 'text', required: true },
        { name: 'time', label: 'Horario', type: 'text', required: true },
      ],
    },
    { name: 'logo', label: 'Logo', type: 'image' },
    {
      name: 'theme',
      label: 'Identidad visual',
      type: 'object',
      fields: [
        { name: 'paper', label: 'Fondo (#RRGGBB)', type: 'text' },
        { name: 'ink', label: 'Texto (#RRGGBB)', type: 'text' },
        { name: 'accent', label: 'Acento (#RRGGBB)', type: 'text' },
        { name: 'font', label: 'Titulares', type: 'select', options: ['editorial', 'sans'] },
        { name: 'button', label: 'Botones', type: 'select', options: ['solid', 'outline'] },
        { name: 'cards', label: 'Composición', type: 'select', options: ['editorial', 'compact'] },
      ],
    },
    { name: 'socialImage', label: 'Imagen social predeterminada', type: 'image' },
    editorialField,
  ],
  story: [
    title,
    { name: 'body', label: 'Historia', type: 'textarea', required: true },
    { name: 'philosophy', label: 'Filosofía', type: 'textarea', required: true },
    { name: 'chefName', label: 'Chef', type: 'text', required: true },
    { name: 'chefBio', label: 'Biografía', type: 'textarea', required: true },
    picture,
  ],
  gallery: [
    {
      name: 'images',
      label: 'Fotografías',
      type: 'array',
      initial: { _type: 'editorialImage', alt: '' },
      fields: [{ name: 'self', label: 'Imagen', type: 'image', required: true }],
    },
  ],
};
export const blockFields: Record<Block['_type'], Field[]> = {
  hero: [title, { name: 'subtitle', label: 'Subtítulo', type: 'text' }, picture, cta],
  richText: [
    { ...title, required: false },
    { name: 'body', label: 'Texto enriquecido', type: 'richtext' },
    { name: 'width', label: 'Anchura', type: 'select', options: ['reading', 'wide'] },
  ],
  imageText: [
    title,
    picture,
    { name: 'body', label: 'Texto', type: 'textarea', required: true },
    {
      name: 'position',
      label: 'Posición de la imagen',
      type: 'select',
      options: ['left', 'right'],
    },
    cta,
  ],
  galleryBlock: [
    title,
    {
      name: 'images',
      label: 'Imágenes',
      type: 'array',
      initial: { _type: 'editorialImage', alt: '' },
      fields: [{ name: 'self', label: 'Imagen', type: 'image', required: true }],
    },
  ],
  menuSection: [
    title,
    {
      name: 'categories',
      label: 'Categorías (vacío: todas)',
      type: 'references',
      target: 'category',
    },
    { name: 'dishes', label: 'Platos (vacío: todos)', type: 'references', target: 'dish' },
  ],
  cards: [
    title,
    {
      name: 'items',
      label: 'Tarjetas',
      type: 'array',
      initial: { _type: 'editorialCard', title: '', description: '' },
      fields: [
        title,
        { name: 'description', label: 'Descripción', type: 'textarea' },
        picture,
        { ...cta, name: 'link' },
      ],
    },
  ],
  cta: [title, { name: 'description', label: 'Descripción', type: 'textarea' }, cta, picture],
  faq: [
    title,
    {
      name: 'items',
      label: 'Preguntas',
      type: 'array',
      initial: { _type: 'questionAnswer', question: '', answer: '' },
      fields: [
        { name: 'question', label: 'Pregunta', type: 'text', required: true },
        { name: 'answer', label: 'Respuesta', type: 'textarea', required: true },
      ],
    },
  ],
  divider: [
    { ...title, required: false },
    { name: 'spacing', label: 'Espacio', type: 'select', options: ['small', 'medium', 'large'] },
    { name: 'line', label: 'Mostrar línea', type: 'boolean' },
  ],
  notice: [
    { ...title, required: false },
    { name: 'text', label: 'Aviso', type: 'textarea', required: true },
    cta,
    { name: 'startsAt', label: 'Desde (ISO 8601, opcional)', type: 'text' },
    { name: 'endsAt', label: 'Hasta (ISO 8601, opcional)', type: 'text' },
  ],
};
export function initialDocument(kind: Kind): Record<string, unknown> {
  if (kind === 'page')
    return {
      title: '',
      slug: { _type: 'slug', current: '' },
      eyebrow: '',
      intro: '',
      status: 'published',
      showInNavigation: true,
      navigationOrder: 4,
      noindex: false,
      blocks: [],
      seo: { _type: 'seo', title: '', description: '' },
    };
  if (kind === 'category') return { name: '', note: '', order: 0, visible: true };
  if (kind === 'dish')
    return {
      name: '',
      description: '',
      price: 0,
      category: { _type: 'reference', _ref: '' },
      allergens: [],
      tags: [],
      order: 0,
      visible: true,
      available: true,
      featured: false,
    };
  return {};
}

export function normalizeDocument(
  kind: Kind,
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(kind === 'page'
      ? { status: 'published', showInNavigation: true, navigationOrder: 4, noindex: false }
      : kind === 'dish' || kind === 'category'
        ? { visible: true }
        : {}),
    ...value,
  };
}

export function contentFields(kind: Kind, document: Record<string, unknown>): Field[] {
  if (kind !== 'page') return fields[kind];
  const slug = (document.slug as { current?: unknown } | undefined)?.current;
  const sections = compositionSections(slug);
  const hasBlocks = Array.isArray(document.blocks) && document.blocks.length > 0;
  return fields.page.flatMap((field) =>
    field.name !== 'composition'
      ? [field]
      : hasBlocks || !sections.length
        ? []
        : [
            {
              ...field,
              fields: field.fields?.filter((section) => sections.includes(section.name)),
            },
          ],
  );
}
