import { z } from 'zod';
import { editorialSchemas } from './editorial.ts';
const text = z.string().trim().min(1).max(20000);
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const documentId = z
  .string()
  .regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/)
  .refine(
    (v) =>
      !v.startsWith('drafts.') &&
      !v.startsWith('versions.') &&
      !v.startsWith('_.') &&
      !v.startsWith('system.'),
    'ID de contenido inválido',
  );
export const reference = z.object({
  _type: z.literal('reference'),
  _ref: documentId,
  _key: key.optional(),
});
export const image = z.object({
  _type: z.literal('editorialImage'),
  asset: reference,
  alt: text.max(500),
  _key: key.optional(),
  crop: z
    .object({
      _type: z.literal('sanity.imageCrop').optional(),
      top: z.number().min(0).max(1),
      bottom: z.number().min(0).max(1),
      left: z.number().min(0).max(1),
      right: z.number().min(0).max(1),
    })
    .optional(),
  hotspot: z
    .object({
      _type: z.literal('sanity.imageHotspot').optional(),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .optional(),
});
export function validLink(v: string) {
  if (/^\/(?!\/)[a-z0-9/#?=&%._-]*$/i.test(v)) return true;
  try {
    return v.startsWith('https://') && new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}
export const link = z.object({
  _type: z.literal('contentLink').optional(),
  label: text.max(120),
  href: z.string().max(2000).refine(validLink, 'Usa HTTPS o una ruta interna'),
});
const { composition, editorial } = editorialSchemas(link);
const common = {
  _key: key,
  title: z.string().max(2000).optional(),
  variant: z.enum(['editorial', 'compact']).optional(),
  alignment: z.enum(['left', 'center']).optional(),
};
const richBody = z
  .array(
    z.object({
      _type: z.literal('block'),
      _key: key,
      style: z.enum(['normal', 'h2', 'h3', 'blockquote']).default('normal'),
      listItem: z.enum(['bullet', 'number']).optional(),
      level: z.number().int().min(1).max(10).optional(),
      markDefs: z
        .array(
          z.object({ _type: z.literal('link'), _key: key, href: z.string().refine(validLink) }),
        )
        .default([]),
      children: z
        .array(
          z.object({
            _type: z.literal('span'),
            _key: key,
            text: z.string().max(20000),
            marks: z.array(z.string()).default([]),
          }),
        )
        .min(1),
    }),
  )
  .min(1)
  .max(200);
export const blockSchema = z.discriminatedUnion('_type', [
  z.object({
    ...common,
    _type: z.literal('hero'),
    title: text,
    subtitle: z.string().optional(),
    image: image.nullish(),
    cta: link.nullish(),
  }),
  z.object({
    ...common,
    _type: z.literal('richText'),
    body: richBody,
    width: z.enum(['reading', 'wide']).optional(),
  }),
  z.object({
    ...common,
    _type: z.literal('imageText'),
    image,
    body: text,
    position: z.enum(['left', 'right']).optional(),
    cta: link.nullish(),
  }),
  z.object({ ...common, _type: z.literal('galleryBlock'), images: z.array(image).min(1).max(100) }),
  z.object({
    ...common,
    _type: z.literal('menuSection'),
    categories: z.array(reference).optional(),
    dishes: z.array(reference).optional(),
  }),
  z.object({
    ...common,
    _type: z.literal('cards'),
    items: z
      .array(
        z.object({
          _type: z.literal('editorialCard').optional(),
          _key: key,
          title: text,
          description: z.string().optional(),
          image: image.nullish(),
          link: link.nullish(),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({
    ...common,
    _type: z.literal('cta'),
    title: text,
    description: z.string().optional(),
    cta: link,
    image: image.nullish(),
  }),
  z.object({
    ...common,
    _type: z.literal('faq'),
    items: z
      .array(
        z.object({
          _type: z.literal('questionAnswer').optional(),
          _key: key,
          question: text,
          answer: text,
        }),
      )
      .min(1)
      .max(100),
  }),
  z.object({
    ...common,
    _type: z.literal('divider'),
    spacing: z.enum(['small', 'medium', 'large']).optional(),
    line: z.boolean().optional(),
  }),
  z.object({
    ...common,
    _type: z.literal('notice'),
    text,
    cta: link.nullish(),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).optional(),
  }),
]);
export const blockNames = [
  'hero',
  'richText',
  'imageText',
  'galleryBlock',
  'menuSection',
  'cards',
  'cta',
  'faq',
  'divider',
  'notice',
] as const;
export const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine(
    (v) =>
      ![
        'index',
        '404',
        'admin',
        'dashboard',
        'api',
        'assets',
        '_astro',
        'robots',
        'sitemap',
      ].includes(v),
    'Ruta reservada',
  );
const strings = z.preprocess(
  (v) =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '')
      : v,
  z
    .array(text.max(80))
    .max(50)
    .refine((v) => new Set(v).size === v.length, 'No repitas valores'),
);
const order = z.number().int().min(0).max(1000000);
const seo = z.object({
  _type: z.literal('seo').optional(),
  title: text.max(200),
  description: text.max(180),
  image: image.nullish(),
});
const theme = z.object({
  _type: z.literal('restaurantTheme').optional(),
  name: z.literal('salitre').optional(),
  paper: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  ink: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  font: z.enum(['editorial', 'sans']).optional(),
  button: z.enum(['solid', 'outline']).optional(),
  cards: z.enum(['editorial', 'compact']).optional(),
});
export const documentSchemas = {
  page: z.object({
    composition: composition.nullish(),
    title: text,
    slug: z.object({ _type: z.literal('slug').optional(), current: slug }),
    status: z.enum(['published', 'hidden']).optional(),
    showInNavigation: z.boolean().optional(),
    navigationLabel: z.string().max(120).nullish(),
    navigationOrder: order.optional(),
    eyebrow: z.string().nullish(),
    intro: z.string().nullish(),
    image: image.nullish(),
    blocks: z.array(blockSchema).max(100).optional(),
    seo,
    noindex: z.boolean().optional(),
  }),
  category: z.object({
    name: text.max(200),
    note: z.string().nullish(),
    order,
    visible: z.boolean().optional(),
  }),
  dish: z.object({
    name: text.max(200),
    description: text,
    price: z
      .number()
      .min(0)
      .max(100000)
      .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 0.00001, 'Máximo dos decimales'),
    category: reference,
    image: image.nullish(),
    allergens: strings,
    available: z.boolean(),
    visible: z.boolean().optional(),
    featured: z.boolean(),
    order,
    tags: strings.optional(),
  }),
  settings: z.object({
    editorial: editorial.nullish(),
    socialImage: image.nullish(),
    name: text.max(120),
    tagline: text,
    concept: text,
    address: text,
    email: z.email(),
    phone: text,
    isFictional: z.boolean(),
    reservationUrl: z
      .url()
      .refine((v) => v.startsWith('https://'))
      .nullish(),
    hours: z
      .array(
        z.object({
          _key: key.optional(),
          _type: z.literal('openingHours').optional(),
          days: text,
          time: text,
        }),
      )
      .min(1)
      .max(50),
    logo: image.nullish(),
    theme: theme.nullish(),
  }),
  story: z.object({
    title: text,
    body: text,
    philosophy: text,
    chefName: text,
    chefBio: text,
    image: image.nullish(),
  }),
  gallery: z.object({ images: z.array(image).max(100) }),
};
export const kinds = ['page', 'category', 'dish', 'settings', 'story', 'gallery'] as const;
export const kindSchema = z.enum(kinds);
export type Kind = z.infer<typeof kindSchema>;
export type Block = z.infer<typeof blockSchema>;
export type JsonRecord = Record<string, unknown>;
export function validateContent(kind: Kind, value: unknown): JsonRecord {
  const result = documentSchemas[kind].parse(value);
  if ('blocks' in result && result.blocks) {
    const keys = result.blocks.map((b) => b._key);
    if (new Set(keys).size !== keys.length) throw new Error('Hay bloques con claves duplicadas');
    for (const block of result.blocks)
      if (
        block._type === 'notice' &&
        block.startsAt &&
        block.endsAt &&
        Date.parse(block.endsAt) < Date.parse(block.startsAt)
      )
        throw new Error('Fechas del aviso inválidas');
  }
  return result;
}
export const singletonIds: Partial<Record<Kind, string>> = {
  settings: 'restaurant-settings',
  story: 'restaurant-story',
  gallery: 'restaurant-gallery',
};
export const revision = z.string().min(1).max(200).nullable();
export const contentRequest = z.discriminatedUnion('action', [
  z.object({ restaurantId: z.uuid(), action: z.literal('list'), kind: kindSchema }),
  z.object({ restaurantId: z.uuid(), action: z.literal('get'), kind: kindSchema, id: documentId }),
  z.object({
    restaurantId: z.uuid(),
    action: z.literal('create'),
    kind: kindSchema,
    document: z.record(z.string(), z.unknown()),
  }),
  z.object({
    restaurantId: z.uuid(),
    action: z.literal('save'),
    kind: kindSchema,
    id: documentId,
    draftRev: revision,
    publishedRev: revision,
    document: z.record(z.string(), z.unknown()),
  }),
  z.object({
    restaurantId: z.uuid(),
    action: z.literal('publish'),
    kind: kindSchema,
    id: documentId,
    draftRev: z.string().min(1),
    publishedRev: revision,
  }),
  z.object({
    restaurantId: z.uuid(),
    action: z.literal('upload'),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    data: z.string().max(11200000),
  }),
]);
export type ContentRequest = z.infer<typeof contentRequest>;
export type Snapshot = {
  id: string;
  kind: Kind;
  draftRev: string | null;
  publishedRev: string | null;
  document: JsonRecord;
};
export type ContentItem = { id: string; title: string; draft: boolean; published: boolean };

export const snapshotSchema = z.object({
  id: documentId,
  kind: kindSchema,
  draftRev: revision,
  publishedRev: revision,
  document: z.record(z.string(), z.unknown()),
});
export const contentItemSchema = z.object({
  id: documentId,
  title: z.string(),
  draft: z.boolean(),
  published: z.boolean(),
});
