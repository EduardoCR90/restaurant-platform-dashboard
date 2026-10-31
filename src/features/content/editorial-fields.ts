import type { Field } from './fields';
export const compositionField: Field = {
  name: 'composition',
  label: 'Textos de la composición original (vacío conserva el actual)',
  type: 'object',
  resettable: true,
  fields: [
    {
      name: 'hero',
      label: 'Hero original',
      type: 'object',
      resettable: true,
      fields: [
        { name: 'caption', label: 'Pie de fotografía', type: 'textarea' },
        { name: 'coordinates', label: 'Coordenadas (una línea por fila)', type: 'textarea' },
        { name: 'sideNote', label: 'Texto lateral', type: 'textarea' },
        { name: 'link', label: 'Enlace', type: 'link', resettable: true },
      ],
    },
    {
      name: 'essence',
      label: 'Concepto',
      type: 'object',
      resettable: true,
      fields: [
        { name: 'eyebrow', label: 'Antetítulo', type: 'textarea' },
        {
          name: 'heading',
          label: 'Titular con énfasis',
          type: 'object',
          resettable: true,
          fields: [
            { name: 'before', label: 'Texto inicial (admite saltos de línea)', type: 'textarea' },
            { name: 'emphasis', label: 'Texto en cursiva', type: 'textarea' },
            { name: 'after', label: 'Texto final', type: 'textarea' },
          ],
        },
        { name: 'link', label: 'Enlace', type: 'link', resettable: true },
      ],
    },
    {
      name: 'featured',
      label: 'Platos destacados',
      type: 'object',
      resettable: true,
      fields: [
        { name: 'eyebrow', label: 'Antetítulo', type: 'textarea' },
        {
          name: 'heading',
          label: 'Titular con énfasis',
          type: 'object',
          resettable: true,
          fields: [
            { name: 'before', label: 'Texto inicial (admite saltos de línea)', type: 'textarea' },
            { name: 'emphasis', label: 'Texto en cursiva', type: 'textarea' },
            { name: 'after', label: 'Texto final', type: 'textarea' },
          ],
        },
        { name: 'link', label: 'Enlace', type: 'link', resettable: true },
        { name: 'empty', label: 'Mensaje sin contenido', type: 'textarea' },
      ],
    },
    {
      name: 'storyPreview',
      label: 'Avance de historia',
      type: 'object',
      resettable: true,
      fields: [
        { name: 'eyebrow', label: 'Antetítulo', type: 'textarea' },
        { name: 'link', label: 'Enlace', type: 'link', resettable: true },
      ],
    },
    {
      name: 'story',
      label: 'Historia',
      type: 'object',
      resettable: true,
      fields: [{ name: 'eyebrow', label: 'Antetítulo', type: 'textarea' }],
    },
    {
      name: 'chef',
      label: 'Chef',
      type: 'object',
      resettable: true,
      fields: [{ name: 'eyebrow', label: 'Antetítulo', type: 'textarea' }],
    },
    {
      name: 'gallery',
      label: 'Galería',
      type: 'object',
      resettable: true,
      fields: [
        { name: 'eyebrow', label: 'Antetítulo', type: 'textarea' },
        {
          name: 'heading',
          label: 'Titular con énfasis',
          type: 'object',
          resettable: true,
          fields: [
            { name: 'before', label: 'Texto inicial (admite saltos de línea)', type: 'textarea' },
            { name: 'emphasis', label: 'Texto en cursiva', type: 'textarea' },
            { name: 'after', label: 'Texto final', type: 'textarea' },
          ],
        },
        { name: 'empty', label: 'Mensaje sin contenido', type: 'textarea' },
      ],
    },
    {
      name: 'contact',
      label: 'Contacto',
      type: 'object',
      resettable: true,
      fields: [
        { name: 'eyebrow', label: 'Antetítulo', type: 'textarea' },
        {
          name: 'heading',
          label: 'Titular con énfasis',
          type: 'object',
          resettable: true,
          fields: [
            { name: 'before', label: 'Texto inicial (admite saltos de línea)', type: 'textarea' },
            { name: 'emphasis', label: 'Texto en cursiva', type: 'textarea' },
            { name: 'after', label: 'Texto final', type: 'textarea' },
          ],
        },
        { name: 'providerLabel', label: 'Texto del botón del proveedor', type: 'textarea' },
        { name: 'hoursTitle', label: 'Título de horarios', type: 'textarea' },
        { name: 'addressTitle', label: 'Título de ubicación', type: 'textarea' },
        { name: 'unavailable', label: 'Mensaje de reservas no activas', type: 'textarea' },
      ],
    },
  ],
};
export const editorialField: Field = {
  name: 'editorial',
  label: 'Cabecera, pie, carta y franja de reservas (vacío conserva el actual)',
  type: 'object',
  resettable: true,
  fields: [
    { name: 'signature', label: 'Firma bajo el logotipo', type: 'textarea' },
    {
      name: 'footer',
      label: 'Pie de página',
      type: 'object',
      resettable: true,
      fields: [
        { name: 'line', label: 'Firma del pie', type: 'textarea' },
        { name: 'link', label: 'Enlace', type: 'link', resettable: true },
        { name: 'backToTop', label: 'Texto para volver arriba', type: 'textarea' },
      ],
    },
    {
      name: 'reservation',
      label: 'Franja de reservas',
      type: 'object',
      resettable: true,
      fields: [
        { name: 'eyebrow', label: 'Antetítulo', type: 'textarea' },
        {
          name: 'heading',
          label: 'Titular con énfasis',
          type: 'object',
          resettable: true,
          fields: [
            { name: 'before', label: 'Texto inicial (admite saltos de línea)', type: 'textarea' },
            { name: 'emphasis', label: 'Texto en cursiva', type: 'textarea' },
            { name: 'after', label: 'Texto final', type: 'textarea' },
          ],
        },
        { name: 'link', label: 'Enlace', type: 'link', resettable: true },
      ],
    },
    {
      name: 'menu',
      label: 'Textos de la carta',
      type: 'object',
      resettable: true,
      fields: [
        { name: 'emptyCategory', label: 'Categoría vacía', type: 'textarea' },
        { name: 'emptyMenu', label: 'Carta vacía', type: 'textarea' },
        { name: 'disclaimer', label: 'Aviso de precios y alérgenos', type: 'textarea' },
        { name: 'noAllergens', label: 'Sin alérgenos declarados', type: 'textarea' },
        { name: 'unavailable', label: 'Plato no disponible', type: 'textarea' },
      ],
    },
  ],
};

// The historical adapter is selected by the existing logical routes; no tenant IDs in forms.
export function compositionSections(slug: unknown): string[] {
  const sections: Record<string, string[]> = {
    inicio: ['hero', 'essence', 'featured', 'storyPreview'],
    restaurante: ['story', 'chef', 'gallery'],
    reservas: ['contact'],
    carta: [],
  };
  return typeof slug === 'string' ? sections[slug] || [] : [];
}
