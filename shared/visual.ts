import { z } from "zod";
// Canonical portable contract, distributed unchanged to the editor/backend and Studio.
export const presetNames = ["elegant", "modern", "casual"] as const;
export const variantOptions = {
  hero: ["editorial", "compact", "split", "cover"],
  menu: ["editorial", "compact", "grid"],
  featured: ["editorial", "compact", "grid"],
  gallery: ["editorial", "compact", "grid"],
  cta: ["editorial", "compact", "split"],
  header: ["editorial", "centered", "compact"],
  footer: ["editorial", "columns", "minimal"],
} as const;
export type VisualComponent = keyof typeof variantOptions;
export function resolveVariant<C extends VisualComponent>(
  component: C,
  value: unknown,
  fallback: unknown = "editorial",
): (typeof variantOptions)[C][number] {
  const options: readonly string[] = variantOptions[component];
  return (
    typeof value === "string" && options.includes(value)
      ? value
      : typeof fallback === "string" && options.includes(fallback)
        ? fallback
        : "editorial"
  ) as (typeof variantOptions)[C][number];
}
export const blockVariantSchemas = {
  hero: z.enum(variantOptions.hero),
  richText: z.enum(["editorial", "compact"]),
  imageText: z.enum(["editorial", "compact"]),
  galleryBlock: z.enum(variantOptions.gallery),
  menuSection: z.enum(variantOptions.menu),
  cards: z.enum(variantOptions.featured),
  cta: z.enum(variantOptions.cta),
  faq: z.enum(["editorial", "compact"]),
  divider: z.enum(["editorial", "compact"]),
  notice: z.enum(["editorial", "compact"]),
};
type OptionalVariants = {
  [K in keyof typeof blockVariantSchemas]: z.ZodOptional<
    (typeof blockVariantSchemas)[K]
  >;
};
export const variantDefaultsSchema = z.object(
  Object.fromEntries(
    Object.entries(blockVariantSchemas).map(([key, schema]) => [
      key,
      schema.optional(),
    ]),
  ) as OptionalVariants,
);
export function variantsForBlock(type: string): readonly string[] {
  return Object.hasOwn(blockVariantSchemas, type)
    ? blockVariantSchemas[type as keyof typeof blockVariantSchemas].options
    : ["editorial", "compact"];
}
export const sectionLabels = {
  hero: "Hero de portada",
  essence: "Concepto gastronómico",
  featured: "Platos destacados",
  storyPreview: "Avance de historia",
  reservation: "CTA de contacto",
  story: "Historia y filosofía",
  chef: "Equipo de cocina",
  gallery: "Galería",
  contact: "Contacto y horarios",
  menu: "Carta",
} as const;
export type SectionName = keyof typeof sectionLabels;
type SectionShape = { [K in SectionName]: z.ZodOptional<z.ZodBoolean> };
const sectionShape = Object.fromEntries(
  Object.keys(sectionLabels).map((key) => [key, z.boolean().optional()]),
) as SectionShape;
export const sectionFlagsSchema = z.object({
  ...sectionShape,
  _type: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .optional(),
});
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Usa un color #RRGGBB");
export const visualTokenSchemas = {
  name: z.string().regex(/^[a-z0-9-]{1,64}$/),
  paper: color,
  ink: color,
  accent: color,
  muted: color,
  line: color,
  imagePlaceholder: color,
  surface: color,
  onDarkMuted: color,
  darkLine: color,
  font: z.enum(["editorial", "sans"]),
  sansFont: z.enum(["system", "humanist", "mono"]),
  button: z.enum(["solid", "outline"]),
  cards: z.enum(["editorial", "compact"]),
  buttonShape: z.enum(["square", "soft", "pill"]),
  gutterMin: z.number().min(0.5).max(4),
  gutterVw: z.number().min(1).max(10),
  gutterMax: z.number().min(4).max(12),
  spaceMin: z.number().min(1).max(8),
  spaceVw: z.number().min(1).max(15),
  spaceMax: z.number().min(8).max(20),
  contentMax: z.number().int().min(960).max(2560),
  readingWidth: z.number().min(24).max(64),
  header: z.enum(variantOptions.header),
  footer: z.enum(variantOptions.footer),
  hero: z.enum(variantOptions.hero),
  menu: z.enum(variantOptions.menu),
  featured: z.enum(variantOptions.featured),
  gallery: z.enum(variantOptions.gallery),
  cta: z.enum(variantOptions.cta),
};
export const visualDefaults = {
  name: "default",
  paper: "#f7f7f5",
  ink: "#222222",
  accent: "#555555",
  muted: "#666666",
  line: "#cccccc",
  imagePlaceholder: "#dddddd",
  surface: "#eeeeee",
  onDarkMuted: "#cccccc",
  darkLine: "#555555",
  font: "editorial",
  sansFont: "system",
  button: "solid",
  cards: "editorial",
  buttonShape: "square",
  gutterMin: 1.25,
  gutterVw: 5,
  gutterMax: 6,
  spaceMin: 4,
  spaceVw: 9,
  spaceMax: 10,
  contentMax: 1900,
  readingWidth: 48,
  header: "editorial",
  footer: "editorial",
  hero: "editorial",
  menu: "editorial",
  featured: "editorial",
  gallery: "editorial",
  cta: "editorial",
} as const;
type Tokens = typeof visualTokenSchemas;
type OptionalShape = { [K in keyof Tokens]: z.ZodOptional<Tokens[K]> };
type DefaultShape = { [K in keyof Tokens]: z.ZodDefault<Tokens[K]> };
const optional = Object.fromEntries(
  Object.entries(visualTokenSchemas).map(([k, v]) => [k, v.optional()]),
) as OptionalShape;
const defaults = Object.fromEntries(
  Object.entries(visualTokenSchemas).map(([k, v]) => [
    k,
    (v as z.ZodType).default(visualDefaults[k as keyof Tokens]),
  ]),
) as DefaultShape;
export const storedThemeSchema = z.object({
  ...optional,
  preset: z.enum(presetNames).optional(),
  _type: z.literal("restaurantTheme").optional(),
});
export const themeSchema = z.object({
  ...defaults,
  preset: z.enum(presetNames).optional(),
});
export type VisualTheme = z.infer<typeof themeSchema>;
export const managedVisualKeys = [
  ...Object.keys(visualTokenSchemas),
  "preset",
] as const;
export const themePresets: Record<(typeof presetNames)[number], VisualTheme> = {
  elegant: {
    ...visualDefaults,
    name: "elegant",
    preset: "elegant",
    paper: "#f5f1e8",
    ink: "#242821",
    accent: "#7f4a35",
    surface: "#e6dfd2",
    footer: "columns",
  },
  modern: {
    ...visualDefaults,
    name: "modern",
    preset: "modern",
    paper: "#fafafa",
    ink: "#171717",
    accent: "#185f71",
    font: "sans",
    button: "outline",
    buttonShape: "soft",
    gutterMin: 1.5,
    gutterMax: 5,
    spaceMin: 3,
    spaceVw: 6,
    spaceMax: 8,
    contentMax: 1440,
    readingWidth: 44,
    header: "compact",
    footer: "minimal",
    hero: "split",
    menu: "compact",
    featured: "grid",
    gallery: "grid",
    cta: "split",
  },
  casual: {
    ...visualDefaults,
    name: "casual",
    preset: "casual",
    paper: "#fff4df",
    ink: "#26211b",
    accent: "#b83b26",
    surface: "#efdfbd",
    font: "sans",
    sansFont: "humanist",
    buttonShape: "pill",
    gutterMin: 1,
    gutterVw: 3,
    gutterMax: 4,
    spaceMin: 2,
    spaceVw: 5,
    spaceMax: 8,
    contentMax: 1600,
    header: "centered",
    footer: "columns",
    hero: "cover",
    menu: "grid",
    featured: "compact",
    gallery: "compact",
    cta: "compact",
  },
};
export function resolveVisualTheme(
  raw: unknown = {},
  legacy: Partial<VisualTheme> = {},
): VisualTheme {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const preset = z.enum(presetNames).safeParse(value.preset);
  const base = preset.success
    ? themePresets[preset.data]
    : { ...visualDefaults, ...legacy };
  const normalized = {
    ...base,
    ...value,
    preset: preset.success
      ? preset.data
      : z.enum(presetNames).safeParse(legacy.preset).success
        ? legacy.preset
        : undefined,
  };
  for (const component of Object.keys(variantOptions) as VisualComponent[])
    Object.assign(normalized, {
      [component]: resolveVariant(component, value[component], base[component]),
    });
  return themeSchema.parse(normalized);
}
export function selectPreset(
  value: Record<string, unknown>,
  preset: (typeof presetNames)[number],
) {
  return {
    ...Object.fromEntries(
      Object.entries(value).filter(([key]) => !managedVisualKeys.includes(key)),
    ),
    preset,
  };
}
export function contrastRatio(a: string, b: string) {
  const light = (hex: string) => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const [x, y] = [light(a), light(b)].sort((a, b) => b - a);
  return (x + 0.05) / (y + 0.05);
}

export const visualLabels: Record<keyof typeof visualTokenSchemas, string> = {
  name: "Nombre interno",
  paper: "Fondo",
  ink: "Texto",
  accent: "Acento",
  muted: "Texto secundario",
  line: "Líneas",
  imagePlaceholder: "Fondo de imágenes",
  surface: "Superficie secundaria",
  onDarkMuted: "Texto sobre fondo oscuro",
  darkLine: "Líneas sobre fondo oscuro",
  font: "Tipografía de titulares",
  sansFont: "Tipografía de texto",
  button: "Estilo de botones",
  cards: "Tarjetas",
  buttonShape: "Forma de botones",
  gutterMin: "Margen mínimo (rem)",
  gutterVw: "Margen fluido (vw)",
  gutterMax: "Margen máximo (rem)",
  spaceMin: "Espacio mínimo (rem)",
  spaceVw: "Espacio fluido (vw)",
  spaceMax: "Espacio máximo (rem)",
  contentMax: "Anchura máxima (px)",
  readingWidth: "Anchura de lectura (rem)",
  header: "Cabecera",
  footer: "Pie de página",
  hero: "Hero",
  menu: "Carta y categorías",
  featured: "Platos destacados",
  gallery: "Galería",
  cta: "CTA",
};
export const optionLabels: Record<string, string> = {
  editorial: "Editorial",
  compact: "Compacta",
  split: "Dividida",
  cover: "Portada fotográfica",
  grid: "Cuadrícula",
  centered: "Centrada",
  columns: "Columnas",
  minimal: "Mínima",
  sans: "Sans contemporánea",
  system: "Sistema",
  humanist: "Humanista",
  mono: "Monoespaciada",
  solid: "Relleno",
  outline: "Contorno",
  square: "Recta",
  soft: "Suave",
  pill: "Redondeada",
};
export const colorFields = [
  "paper",
  "ink",
  "accent",
  "muted",
  "line",
  "surface",
  "imagePlaceholder",
  "onDarkMuted",
  "darkLine",
] as const;
export const numberFields = [
  "gutterMin",
  "gutterVw",
  "gutterMax",
  "spaceMin",
  "spaceVw",
  "spaceMax",
  "contentMax",
  "readingWidth",
] as const;
export const choiceFields = [
  "font",
  "sansFont",
  "button",
  "buttonShape",
  "cards",
  "header",
  "footer",
  "hero",
  "menu",
  "featured",
  "gallery",
  "cta",
] as const;
